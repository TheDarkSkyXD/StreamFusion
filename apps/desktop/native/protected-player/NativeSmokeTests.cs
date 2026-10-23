using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

class NativeSmokeTests
{
    const int GwChild = 5;
    const int GwHwndNext = 2;
    const int GwlStyle = -16;
    const long WsChild = 0x40000000;

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")]
    static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll")]
    static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")]
    static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    [StructLayout(LayoutKind.Sequential)]
    struct NativeRect { public int Left, Top, Right, Bottom; }

    [STAThread]
    static int Main(string[] args)
    {
        using (var owner = new Form { StartPosition = FormStartPosition.Manual, Bounds = new Rectangle(100, 100, 800, 500) })
        {
            var sibling = new Panel { Bounds = new Rectangle(20, 20, 300, 180), BackColor = Color.Blue };
            owner.Controls.Add(sibling);
            owner.Show();
            var ownerHandle = owner.Handle;
            var siblingHandle = sibling.Handle;
            using (var child = Start(args[0], args[1], ownerHandle))
            {
                try
                {
                    var host = WaitFor(() => ChildOfProcess(ownerHandle, child.Id), "hidden child");
                    if (GetParent(host) != ownerHandle || (GetWindowLongPtr(host, GwlStyle).ToInt64() & WsChild) == 0)
                        throw new Exception("Protected host is not a WS_CHILD of the parent.");
                    if (IsWindowVisible(host)) throw new Exception("Protected host was visible before placement.");
                    var point = owner.PointToScreen(new Point(70, 70));
                    if (WindowFromPoint(point) != siblingHandle) throw new Exception("Hidden host stole the sibling hit.");
                    child.StandardInput.WriteLine(Present(1, true));
                    ExpectEvent(child, "presented", 30000);
                    WaitFor(() => IsWindowVisible(host) ? host : IntPtr.Zero, "visible child");
                    var browser = WaitFor(() => BrowserDescendant(host), "WebView browser child");
                    WaitFor(() => IsWindowVisible(browser) ? browser : IntPtr.Zero, "visible WebView browser child", 5000);
                    if (GetParent(host) != ownerHandle || (GetWindowLongPtr(host, GwlStyle).ToInt64() & WsChild) == 0)
                        throw new Exception("Shown protected host lost its WS_CHILD parent.");
                    var hit = WindowFromPoint(point);
                    if (hit != host && !IsChild(host, hit)) throw new Exception("Visible host lost the sibling hit: " + hit);
                    NativeRect bounds;
                    GetWindowRect(host, out bounds);
                    if (Math.Abs(bounds.Left - owner.PointToScreen(new Point(20, 20)).X) > 1 ||
                        Math.Abs(bounds.Top - owner.PointToScreen(new Point(20, 20)).Y) > 1 ||
                        Math.Abs(bounds.Right - bounds.Left - 300) > 1)
                        throw new Exception("Protected host bounds did not match parent-client placement.");
                    child.StandardInput.WriteLine("{\"type\":\"suspend\"}");
                    WaitFor(() => !IsWindowVisible(host) ? host : IntPtr.Zero, "suspended child");
                    if (IsWindowVisible(browser)) throw new Exception("Suspended WebView browser stayed visible.");
                    if (WindowFromPoint(point) != siblingHandle) throw new Exception("Suspended host stole a sibling hit.");
                    child.StandardInput.WriteLine("{\"type\":\"raise\"}");
                    WaitFor(() => IsWindowVisible(host) ? host : IntPtr.Zero, "raised child");
                    WaitFor(() => IsWindowVisible(browser) ? browser : IntPtr.Zero, "raised WebView browser child", 5000);
                    child.StandardInput.WriteLine(Present(2, false));
                    ExpectEvent(child, "presented", 10000);
                    if (WindowFromPoint(point) != siblingHandle) throw new Exception("Hidden host still stole the sibling hit.");
                    child.StandardInput.WriteLine(Present(3, true));
                    ExpectEvent(child, "presented", 10000);
                    WaitFor(() => IsWindowVisible(browser) ? browser : IntPtr.Zero, "re-shown WebView browser child", 5000);
                    hit = WindowFromPoint(point);
                    if (hit != host && !IsChild(host, hit)) throw new Exception("Re-shown host lost its hit.");
                    child.StandardInput.WriteLine(Present(4, true).Replace("\"clipX\":0", "\"clipX\":100")
                        .Replace("\"clipWidth\":300", "\"clipWidth\":200"));
                    ExpectEvent(child, "presented", 10000);
                    if (WindowFromPoint(point) != siblingHandle) throw new Exception("Clipped host stole an outside hit.");
                    hit = WindowFromPoint(owner.PointToScreen(new Point(170, 70)));
                    if (hit != host && !IsChild(host, hit)) throw new Exception("Clipped host lost an inside hit.");
                    child.StandardInput.WriteLine(Present(2, true));
                    Thread.Sleep(100);
                    if (WindowFromPoint(point) != siblingHandle) throw new Exception("Stale placement replaced the clipped region.");
                    owner.Close();
                    ExpectEvent(child, "closed", 10000);
                    if (!child.WaitForExit(10000) || child.ExitCode != 0) throw new Exception("Helper survived parent destruction.");
                    if (child.StandardOutput.ReadToEnd().Trim().Length != 0) throw new Exception("Duplicate terminal event.");
                }
                finally { if (!child.HasExited) child.Kill(); }
            }
        }
        Console.WriteLine("NativeSmokeTests passed");
        return 0;
    }

    static Process Start(string executable, string profile, IntPtr owner)
    {
        return Process.Start(new ProcessStartInfo(executable) {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Arguments = "--channel primevideo --owner " + owner.ToInt64() +
                " --parent-pid " + Process.GetCurrentProcess().Id +
                " --user-data-dir \"" + profile + "\" --muted true"
        });
    }

    static string Present(int revision, bool visible)
    {
        if (!visible) return "{\"type\":\"present\",\"revision\":" + revision + ",\"visible\":false}";
        return "{\"type\":\"present\",\"revision\":" + revision +
            ",\"visible\":true,\"x\":20,\"y\":20,\"width\":300,\"height\":180,\"clipX\":0,\"clipY\":0," +
            "\"clipWidth\":300,\"clipHeight\":180,\"radius\":0,\"zoom\":1,\"presentation\":\"docked\",\"blockerEnabled\":true}";
    }

    static IntPtr ChildOfProcess(IntPtr owner, int pid)
    {
        for (var window = GetWindow(owner, GwChild); window != IntPtr.Zero; window = GetWindow(window, GwHwndNext))
        {
            uint windowPid;
            GetWindowThreadProcessId(window, out windowPid);
            if (windowPid == pid) return window;
        }
        return IntPtr.Zero;
    }

    static IntPtr BrowserDescendant(IntPtr parent)
    {
        for (var child = GetWindow(parent, GwChild); child != IntPtr.Zero; child = GetWindow(child, GwHwndNext))
        {
            var name = new StringBuilder(64);
            GetClassName(child, name, name.Capacity);
            if (name.ToString() == "Chrome_WidgetWin_0") return child;
            var browser = BrowserDescendant(child);
            if (browser != IntPtr.Zero) return browser;
        }
        return IntPtr.Zero;
    }

    static IntPtr WaitFor(Func<IntPtr> find, string label, int timeout = 30000)
    {
        var limit = DateTime.UtcNow.AddMilliseconds(timeout);
        while (DateTime.UtcNow < limit)
        {
            Application.DoEvents();
            var found = find();
            if (found != IntPtr.Zero) return found;
            Thread.Sleep(20);
        }
        throw new Exception("Timed out waiting for " + label);
    }

    static void ExpectEvent(Process child, string type, int timeout)
    {
        var read = Task.Run(() => child.StandardOutput.ReadLine());
        var limit = DateTime.UtcNow.AddMilliseconds(timeout);
        while (!read.IsCompleted && DateTime.UtcNow < limit)
        {
            Application.DoEvents();
            Thread.Sleep(20);
        }
        if (!read.IsCompleted || read.Result == null || !read.Result.Contains("\"type\":\"" + type + "\""))
            throw new Exception("Expected " + type + ": " + (read.IsCompleted ? read.Result : "timeout"));
    }
}
