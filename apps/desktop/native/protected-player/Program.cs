using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    static readonly object OutputLock = new object();
    static StreamWriter output;

    [STAThread]
    static int Main(string[] args)
    {
        output = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
        PlayerOptions options;
        try { options = HostProtocol.TryParseOptions(args); }
        catch (ArgumentException error)
        {
            Emit("failed", error.Message);
            return 2;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = new ProtectedPlayerForm(options, Emit);
        var input = new Thread(() => ReadCommands(form)) { IsBackground = true };
        form.Shown += (sender, eventArgs) => input.Start();
        try { Application.Run(form); }
        catch (Exception error)
        {
            Emit("failed", error.Message);
            return 1;
        }
        return 0;
    }

    static void ReadCommands(ProtectedPlayerForm form)
    {
        try
        {
            using (var reader = new StreamReader(Console.OpenStandardInput()))
            {
                while (true)
                {
                    string line;
                    try { line = HostProtocol.ReadCommandLine(reader); }
                    catch (ArgumentException) { continue; }
                    if (line == null) break;
                    PlayerCommand command;
                    try { command = HostProtocol.ParseCommand(line); }
                    catch (ArgumentException) { continue; }
                    try { form.BeginInvoke((Action)(() => form.Apply(command))); }
                    catch (InvalidOperationException) { return; }
                }
            }
        }
        finally
        {
            try { form.BeginInvoke((Action)(() => form.Close())); }
            catch (InvalidOperationException) { }
        }
    }

    static void Emit(string type, string message)
    {
        lock (OutputLock) output.WriteLine(HostProtocol.Event(type, message));
    }
}
