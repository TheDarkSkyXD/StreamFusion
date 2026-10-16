using System;
using System.IO;

class HostProtocolTests
{
    static int Main()
    {
        Check(HostProtocol.TryParseOptions(new[] {
            "--channel", "PrimeVideo", "--owner", "12345", "--parent-pid", "456",
            "--user-data-dir", @"C:\StreamFusion\protected-player", "--muted", "true"
        }).Channel == "primevideo", "channel normalized");
        Check(HostProtocol.BuildPlayerUrl("primevideo") ==
            "https://player.twitch.tv/?channel=primevideo&parent=player.twitch.tv&autoplay=true&muted=false",
            "fixed player URL");
        Reject(new[] { "--channel", "bad/url", "--owner", "12345", "--parent-pid", "456",
            "--user-data-dir", @"C:\StreamFusion\protected-player", "--muted", "false" }, "invalid channel");
        Reject(new[] { "--channel", "primevideo", "--owner", "0", "--parent-pid", "456",
            "--user-data-dir", @"C:\StreamFusion\protected-player", "--muted", "false" }, "zero owner");
        Reject(new[] { "--channel", "primevideo", "--owner", "12345", "--parent-pid", "456",
            "--user-data-dir", "relative", "--muted", "false" }, "relative profile");
        Check(HostProtocol.ParseCommand("{\"type\":\"mute\",\"muted\":false}").Type == "mute", "mute command");
        Check(HostProtocol.ParseCommand("{\"type\":\"focus\"}").Type == "focus", "focus command");
        Check(HostProtocol.ParseCommand("{\"type\":\"close\"}").Type == "close", "close command");
        RejectCommand("{\"type\":\"mute\",\"muted\":\"false\"}", "non-boolean mute");
        RejectCommand("{\"type\":\"navigate\",\"url\":\"https://example.com\"}", "navigation command");
        RejectCommand(new string(' ', 4097), "oversize command");
        using (var input = new StringReader(new string('x', 4097) + "\n{\"type\":\"close\"}\n"))
        {
            try { HostProtocol.ReadCommandLine(input); throw new Exception("oversize input line"); }
            catch (ArgumentException) { }
            Check(HostProtocol.ParseCommand(HostProtocol.ReadCommandLine(input)).Type == "close", "reader resumes after oversized line");
        }
        Console.WriteLine("HostProtocolTests passed");
        return 0;
    }

    static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
    }

    static void Reject(string[] args, string name)
    {
        try { HostProtocol.TryParseOptions(args); }
        catch (ArgumentException) { return; }
        throw new Exception(name);
    }

    static void RejectCommand(string line, string name)
    {
        try { HostProtocol.ParseCommand(line); }
        catch (ArgumentException) { return; }
        throw new Exception(name);
    }
}
