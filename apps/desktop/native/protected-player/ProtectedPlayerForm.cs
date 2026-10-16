using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

sealed class ProtectedPlayerForm : Form
{
    const int OwnerIndex = -8;
    readonly PlayerOptions options;
    readonly Action<string, string> emit;
    readonly WebView2 view = new WebView2();
    readonly Timer parentTimer = new Timer { Interval = 1000 };
    bool failed;
    bool closing;
    bool closed;
    bool muted;
    Rectangle normalBounds;
    FormWindowState normalState;

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("kernel32.dll")]
    static extern void SetLastError(int code);

    public ProtectedPlayerForm(PlayerOptions options, Action<string, string> emit)
    {
        this.options = options;
        this.emit = emit;
        muted = options.Muted;
        Text = "StreamFusion - " + options.Channel;
        Width = 1280;
        Height = 800;
        MinimumSize = new System.Drawing.Size(480, 320);
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = false;
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
        parentTimer.Tick += (sender, args) => { if (!ParentIsAlive()) Close(); };
        Shown += (sender, args) => { AttachOwner(); StartPlayer(); };
        FormClosing += (sender, args) => { closing = true; };
        FormClosed += (sender, args) =>
        {
            if (closed) return;
            closed = true;
            parentTimer.Stop();
            emit("closed", null);
        };
    }

    void AttachOwner()
    {
        SetLastError(0);
        if (SetWindowLongPtr(Handle, OwnerIndex, options.Owner) == IntPtr.Zero && Marshal.GetLastWin32Error() != 0)
            throw new InvalidOperationException("Could not attach the player to StreamFusion.");
    }

    bool ParentIsAlive()
    {
        try
        {
            using (var parent = Process.GetProcessById(options.ParentPid)) return !parent.HasExited;
        }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (Win32Exception) { return false; }
    }

    async void StartPlayer()
    {
        if (!ParentIsAlive()) { Close(); return; }
        parentTimer.Start();
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
            view.CoreWebView2.ContainsFullScreenElementChanged += (sender, args) =>
            {
                if (view.CoreWebView2.ContainsFullScreenElement)
                {
                    normalBounds = Bounds;
                    normalState = WindowState;
                    WindowState = FormWindowState.Normal;
                    FormBorderStyle = FormBorderStyle.None;
                    Bounds = Screen.FromControl(this).Bounds;
                }
                else
                {
                    FormBorderStyle = FormBorderStyle.Sizable;
                    Bounds = normalBounds;
                    WindowState = normalState;
                }
            };
            view.CoreWebView2.NewWindowRequested += (sender, args) => { args.Handled = true; };
            view.CoreWebView2.NavigationStarting += (sender, args) =>
            {
                Uri target;
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out target) ||
                    target.Scheme != Uri.UriSchemeHttps || target.Host != "player.twitch.tv" || target.AbsolutePath != "/")
                    args.Cancel = true;
            };
            view.CoreWebView2.NavigationCompleted += (sender, args) =>
            {
                if (!args.IsSuccess) Fail("Twitch player navigation failed: " + args.WebErrorStatus);
            };
            view.CoreWebView2.ProcessFailed += (sender, args) => Fail("The Twitch player process stopped.");
            view.CoreWebView2.Navigate(HostProtocol.BuildPlayerUrl(options.Channel));
            emit("ready", null);
        }
        catch (Exception error) { Fail(error.Message); }
    }

    void Fail(string message)
    {
        if (failed || closing || IsDisposed) return;
        failed = true;
        emit("failed", message);
        Close();
    }

    public void Apply(PlayerCommand command)
    {
        switch (command.Type)
        {
            case "focus":
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                break;
            case "close":
                Close();
                break;
            case "mute":
                muted = command.Muted;
                if (view.CoreWebView2 != null) view.CoreWebView2.IsMuted = command.Muted;
                break;
        }
    }
}
