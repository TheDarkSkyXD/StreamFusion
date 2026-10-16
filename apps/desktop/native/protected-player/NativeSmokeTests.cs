using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

class NativeSmokeTests
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr window, uint command);

    [STAThread]
    static int Main(string[] args)
    {
        using (var owner = new Form())
        {
            var handle = owner.Handle;
            Run(args[0], args[1], handle, null, "closed");
            Run(args[0], args[1], handle, "{\"type\":\"close\"}\n", "closed");
            Run(args[0], args[1], handle, "interactive", "ready");
        }
        Console.WriteLine("NativeSmokeTests passed");
        return 0;
    }

    static void Run(string executable, string profile, IntPtr owner, string firstInput, string expectedFirst)
    {
        var start = new ProcessStartInfo(executable) {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Arguments = "--channel primevideo --owner " + owner.ToInt64() +
                " --parent-pid " + Process.GetCurrentProcess().Id +
                " --user-data-dir \"" + profile + "\" --muted true"
        };
        using (var child = Process.Start(start))
        {
            try
            {
                if (firstInput == null) child.StandardInput.Close();
                else if (firstInput == "interactive") { }
                else { child.StandardInput.Write(firstInput); child.StandardInput.Close(); }

                var first = Task.Run(() => child.StandardOutput.ReadLine());
                if (!first.Wait(30000)) throw new Exception("Timed out waiting for " + expectedFirst);
                if (first.Result == null || !first.Result.Contains("\"type\":\"" + expectedFirst + "\""))
                    throw new Exception("Unexpected first event: " + first.Result);
                if (firstInput == "interactive")
                {
                    var playerWindow = FindWindow(null, "StreamFusion - primevideo");
                    var actualOwner = playerWindow == IntPtr.Zero ? IntPtr.Zero : GetWindow(playerWindow, 4);
                    if (playerWindow == IntPtr.Zero || actualOwner != owner)
                        throw new Exception("Player window owner mismatch: player=" + playerWindow + " actual=" + actualOwner + " expected=" + owner);
                    child.StandardInput.WriteLine("{\"type\":\"mute\",\"muted\":false}");
                    child.StandardInput.WriteLine("{\"type\":\"focus\"}");
                    child.StandardInput.WriteLine("{\"type\":\"close\"}");
                    child.StandardInput.Close();
                    var last = Task.Run(() => child.StandardOutput.ReadLine());
                    if (!last.Wait(10000) || last.Result == null || !last.Result.Contains("\"type\":\"closed\""))
                        throw new Exception("Expected closed event after close command: " + (last.IsCompleted ? last.Result : "timeout"));
                }
                if (!child.WaitForExit(10000)) throw new Exception("Helper did not exit.");
                if (child.ExitCode != 0) throw new Exception("Helper exited with " + child.ExitCode);
                if (child.StandardOutput.ReadToEnd().Trim().Length != 0)
                    throw new Exception("Unexpected duplicate terminal event.");
            }
            finally
            {
                if (!child.HasExited) child.Kill();
            }
        }
    }
}
