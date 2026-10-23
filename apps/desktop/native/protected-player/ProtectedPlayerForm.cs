using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

sealed class ProtectedPlayerForm : Form
{
    const int GwlStyle = -16;
    const long WsChild = 0x40000000;
    const long WsClipChildren = 0x02000000;
    const long WsClipSiblings = 0x04000000;
    const int SwpNoActivate = 0x0010;
    const int SwpFrameChanged = 0x0020;
    const int SwpShowWindow = 0x0040;
    const int SwpHideWindow = 0x0080;
    static readonly IntPtr HwndTop = IntPtr.Zero;

    readonly PlayerOptions options;
    readonly Action<string, string> emit;
    readonly WebView2 view = new WebView2();
    readonly Timer parentTimer = new Timer { Interval = 1000 };
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    ProtectedPlayerBridge bridge;
    PlayerCommand placement;
    string sessionBaseUrl;
    bool pageStarted;
    bool initialized;
    bool failed;
    bool closing;
    bool closed;
    bool muted;
    bool fullscreen;
    bool parentSuppressed;
    int lastRevision = -1;

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetParent(IntPtr child, IntPtr parent);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);

    [DllImport("user32.dll")]
    static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    static extern bool GetClientRect(IntPtr window, out NativeRect rect);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr handle);

    [DllImport("gdi32.dll")]
    static extern int CombineRgn(IntPtr destination, IntPtr first, IntPtr second, int mode);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);

    [DllImport("kernel32.dll")]
    static extern void SetLastError(int code);

    [StructLayout(LayoutKind.Sequential)]
    struct NativeRect { public int Left, Top, Right, Bottom; }

    protected override bool ShowWithoutActivation { get { return true; } }

    public ProtectedPlayerForm(PlayerOptions options, Action<string, string> emit)
    {
        this.options = options;
        this.emit = emit;
        muted = options.Muted;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(0, 0, 1, 1);
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
        parentTimer.Tick += (sender, args) => { if (!ParentIsAlive()) Close(); };
        FormClosing += (sender, args) => { closing = true; };
        FormClosed += (sender, args) => Finish();
    }

    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        if (message.Msg == 0x0082) Finish();
    }

    void Finish()
    {
        if (closed) return;
        closed = true;
        parentTimer.Stop();
        if (bridge != null) bridge.Dispose();
        view.Dispose();
        emit("closed", null);
        Application.ExitThread();
    }

    public void AttachHidden()
    {
        var handle = Handle;
        var style = GetWindowLongPtr(handle, GwlStyle).ToInt64();
        SetWindowLongPtr(handle, GwlStyle, new IntPtr(style | WsChild | WsClipChildren | WsClipSiblings));
        SetLastError(0);
        if (SetParent(handle, options.Owner) == IntPtr.Zero && Marshal.GetLastWin32Error() != 0)
            throw new InvalidOperationException("Could not attach the protected player.");
        if (!AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(handle), GetWindowDpiAwarenessContext(options.Owner)))
            throw new InvalidOperationException("Protected player display scaling does not match StreamFusion.");
        if (!SetWindowPos(handle, HwndTop, 0, 0, 1, 1, SwpNoActivate | SwpHideWindow | SwpFrameChanged))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        parentTimer.Start();
    }

    bool ParentIsAlive()
    {
        if (!IsWindow(options.Owner)) return false;
        uint windowPid;
        GetWindowThreadProcessId(options.Owner, out windowPid);
        if (windowPid != options.ParentPid) return false;
        try
        {
            using (var parent = Process.GetProcessById(options.ParentPid)) return !parent.HasExited;
        }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (Win32Exception) { return false; }
    }

    public async void StartPlayer()
    {
        if (!ParentIsAlive()) { Close(); return; }
        try
        {
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (Exception) { Fail("runtime-missing"); return; }
            var settings = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var environment = await CoreWebView2Environment.CreateAsync(null, options.UserDataDir, settings);
            if (closing || IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (closing || IsDisposed) return;
            view.CoreWebView2.IsMuted = muted;
            var rendererPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "renderer");
            if (!File.Exists(Path.Combine(rendererPath, "src", "frontend", "features", "playback", "routes", "protected-player.html")))
            {
                Fail("Protected player page is missing.");
                return;
            }
            view.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "streamfusion.test", rendererPath, CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.ContainsFullScreenElementChanged += (sender, args) =>
            {
                fullscreen = view.CoreWebView2.ContainsFullScreenElement;
                emit("fullscreen", fullscreen ? "true" : "false");
                ApplyPlacement();
            };
            view.CoreWebView2.NewWindowRequested += (sender, args) => { args.Handled = true; };
            view.CoreWebView2.NavigationStarting += (sender, args) =>
            {
                Uri target;
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out target) ||
                    target.AbsoluteUri != HostProtocol.BuildPlayerUrl()) args.Cancel = true;
            };
            view.CoreWebView2.NavigationCompleted += (sender, args) =>
            {
                if (!args.IsSuccess) Fail("Protected player navigation failed: " + args.WebErrorStatus);
            };
            view.CoreWebView2.WebMessageReceived += (sender, args) =>
            {
                if (args.Source != HostProtocol.BuildPlayerUrl()) return;
                string message;
                try { message = args.TryGetWebMessageAsString(); }
                catch { return; }
                if (message == "page-ready")
                {
                    view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "bootstrap", baseUrl = sessionBaseUrl }));
                    PostPresentation();
                }
                else if (message == "bootstrap-ready") emit("ready", null);
                else if (message == "playback-ready") emit("playing", null);
                else if (message == "playback-failed") Fail("Protected playback failed.");
                else if (message.Length <= 256 && message.StartsWith("{\"type\":\"volume\",")) emit("volume", message);
                else if (message == "action:expand" || message == "action:close" || message == "action:theater" ||
                    message == "action:back" || message == "action:forward" ||
                    message == "action:tab-next" || message == "action:tab-previous")
                    emit("action", message.Substring(7));
                else if (message.Length <= 256 && message.StartsWith("{\"type\":\"drag\","))
                {
                    try
                    {
                        var drag = json.Deserialize<Dictionary<string, object>>(message);
                        double dx = Convert.ToDouble(drag["dx"]);
                        double dy = Convert.ToDouble(drag["dy"]);
                        if (!Double.IsNaN(dx) && !Double.IsNaN(dy) && Math.Abs(dx) <= 2000 && Math.Abs(dy) <= 2000)
                            emit("drag", json.Serialize(new { dx = dx, dy = dy }));
                    }
                    catch { }
                }
            };
            view.CoreWebView2.ProcessFailed += (sender, args) => Fail("The protected player process stopped.");
            initialized = true;
            ApplyPlacement();
            if (placement != null && placement.Visible) emit("presented", placement.Revision.ToString());
            TryStartPage();
        }
        catch (Exception error) { Fail(error.Message); }
    }

    void TryStartPage()
    {
        if (pageStarted || sessionBaseUrl == null || view.CoreWebView2 == null) return;
        pageStarted = true;
        bridge = new ProtectedPlayerBridge(view.CoreWebView2, sessionBaseUrl);
        view.CoreWebView2.Navigate(HostProtocol.BuildPlayerUrl());
    }

    void Fail(string message)
    {
        if (failed || closing || IsDisposed) return;
        failed = true;
        emit("failed", message);
        Close();
    }

    static int Edge(double value, double scale) { return (int)Math.Round(value * scale, MidpointRounding.AwayFromZero); }

    void PostPresentation()
    {
        if (placement != null && placement.Visible && view.CoreWebView2 != null)
            view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                type = "presentation", presentation = placement.Presentation, blockerEnabled = placement.BlockerEnabled,
                zoom = placement.Zoom
            }));
    }

    void ApplyPlacement()
    {
        if (placement == null || !ParentIsAlive()) { if (!closing && placement != null) Close(); return; }
        if (!placement.Visible || !initialized || parentSuppressed)
        {
            Hide();
            SetWindowPos(Handle, HwndTop, 0, 0, 0, 0, SwpNoActivate | SwpHideWindow);
            return;
        }
        NativeRect parent;
        if (!GetClientRect(options.Owner, out parent)) { Close(); return; }
        double scale = placement.Zoom * GetDpiForWindow(options.Owner) / 96.0;
        int left = fullscreen ? 0 : Edge(placement.X, scale);
        int top = fullscreen ? 0 : Edge(placement.Y, scale);
        int right = fullscreen ? parent.Right : Edge(placement.X + placement.Width, scale);
        int bottom = fullscreen ? parent.Bottom : Edge(placement.Y + placement.Height, scale);
        int width = Math.Max(1, right - left);
        int height = Math.Max(1, bottom - top);
        int clipLeft = fullscreen ? 0 : Math.Max(0, Edge(placement.ClipX, scale));
        int clipTop = fullscreen ? 0 : Math.Max(0, Edge(placement.ClipY, scale));
        int clipRight = fullscreen ? width : Math.Min(width, Edge(placement.ClipX + placement.ClipWidth, scale));
        int clipBottom = fullscreen ? height : Math.Min(height, Edge(placement.ClipY + placement.ClipHeight, scale));
        clipLeft = Math.Max(clipLeft, -left);
        clipTop = Math.Max(clipTop, -top);
        clipRight = Math.Min(clipRight, parent.Right - left);
        clipBottom = Math.Min(clipBottom, parent.Bottom - top);
        if (clipRight <= clipLeft || clipBottom <= clipTop)
        {
            Hide();
            SetWindowPos(Handle, HwndTop, left, top, width, height, SwpNoActivate | SwpHideWindow);
            return;
        }
        int diameter = fullscreen ? 0 : Edge(placement.Radius * 2, scale);
        IntPtr region = CreateRectRgn(clipLeft, clipTop, clipRight, clipBottom);
        if (region == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (diameter > 0)
        {
            IntPtr rounded = CreateRoundRectRgn(0, 0, width + 1, height + 1, diameter, diameter);
            if (rounded == IntPtr.Zero || CombineRgn(region, region, rounded, 1) == 0)
            {
                if (rounded != IntPtr.Zero) DeleteObject(rounded);
                DeleteObject(region);
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            DeleteObject(rounded);
        }
        if (SetWindowRgn(Handle, region, true) == 0)
        {
            DeleteObject(region);
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if (!SetWindowPos(Handle, HwndTop, left, top, width, height, SwpNoActivate))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        Show();
        if (!SetWindowPos(Handle, HwndTop, left, top, width, height, SwpNoActivate | SwpShowWindow))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        view.ZoomFactor = placement.Zoom;
        view.Invalidate();
        Invalidate();
    }

    public void Apply(PlayerCommand command)
    {
        switch (command.Type)
        {
            case "focus":
                if (placement != null && placement.Visible && initialized && !parentSuppressed) view.Focus();
                break;
            case "raise":
                parentSuppressed = false;
                if (placement != null && placement.Visible && initialized) ApplyPlacement();
                break;
            case "suspend":
                parentSuppressed = true;
                ApplyPlacement();
                break;
            case "close": Close(); break;
            case "mute":
                muted = command.Muted;
                if (view.CoreWebView2 != null) view.CoreWebView2.IsMuted = muted;
                break;
            case "session":
                sessionBaseUrl = command.BaseUrl;
                TryStartPage();
                break;
            case "present":
                if (command.Revision <= lastRevision) break;
                lastRevision = command.Revision;
                placement = command;
                if (initialized) ApplyPlacement();
                PostPresentation();
                if (initialized || !command.Visible) emit("presented", command.Revision.ToString());
                break;
        }
    }
}
