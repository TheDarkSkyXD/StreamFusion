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
        Check(HostProtocol.BuildPlayerUrl() == "https://streamfusion.test/src/frontend/features/playback/routes/protected-player.html",
            "app-owned player URL");
        Reject(new[] { "--channel", "bad/url", "--owner", "12345", "--parent-pid", "456",
            "--user-data-dir", @"C:\StreamFusion\protected-player", "--muted", "false" }, "invalid channel");
        Reject(new[] { "--channel", "primevideo", "--owner", "0", "--parent-pid", "456",
            "--user-data-dir", @"C:\StreamFusion\protected-player", "--muted", "false" }, "zero owner");
        Reject(new[] { "--channel", "primevideo", "--owner", "12345", "--parent-pid", "456",
            "--user-data-dir", "relative", "--muted", "false" }, "relative profile");
        Check(HostProtocol.ParseCommand("{\"type\":\"mute\",\"muted\":false}").Type == "mute", "mute command");
        Check(HostProtocol.ParseCommand("{\"type\":\"focus\"}").Type == "focus", "focus command");
        Check(HostProtocol.ParseCommand("{\"type\":\"close\"}").Type == "close", "close command");
        var placement = HostProtocol.ParseCommand("{\"type\":\"present\",\"revision\":2,\"visible\":true,\"x\":10,\"y\":20,\"width\":640,\"height\":360,\"clipX\":0,\"clipY\":30,\"clipWidth\":640,\"clipHeight\":330,\"radius\":0,\"zoom\":1,\"presentation\":\"docked\",\"blockerEnabled\":true}");
        Check(placement.Type == "present" && placement.Revision == 2 && placement.Width == 640, "visible placement");
        var theater = HostProtocol.ParseCommand("{\"type\":\"present\",\"revision\":3,\"visible\":true,\"x\":10,\"y\":20,\"width\":640,\"height\":360,\"clipX\":0,\"clipY\":0,\"clipWidth\":640,\"clipHeight\":360,\"radius\":0,\"zoom\":1.25,\"presentation\":\"theater\",\"blockerEnabled\":true}");
        Check(theater.Presentation == "theater" && theater.Zoom == 1.25, "theater placement and zoom");
        RejectCommand("{\"type\":\"present\",\"revision\":-1,\"visible\":false}", "negative revision");
        RejectCommand("{\"type\":\"present\",\"revision\":3,\"visible\":true,\"x\":10,\"y\":20,\"width\":640,\"height\":360,\"clipX\":0,\"clipY\":0,\"clipWidth\":700,\"clipHeight\":360,\"radius\":0,\"zoom\":1}", "clip exceeds player");
        RejectCommand("{\"type\":\"present\",\"revision\":3,\"visible\":true,\"x\":10,\"y\":20,\"width\":-1,\"height\":360,\"clipX\":0,\"clipY\":0,\"clipWidth\":1,\"clipHeight\":360,\"radius\":0,\"zoom\":1}", "negative size");
        string baseUrl = "http://127.0.0.1:45678/s/" + new string('a', 64);
        Check(HostProtocol.ParseCommand("{\"type\":\"session\",\"baseUrl\":\"" + baseUrl + "\"}").BaseUrl == baseUrl,
            "session bootstrap command");
        RejectCommand("{\"type\":\"session\",\"baseUrl\":\"https://example.com\"}", "external session origin");
        RejectCommand("{\"type\":\"mute\",\"muted\":\"false\"}", "non-boolean mute");
        RejectCommand("{\"type\":\"navigate\",\"url\":\"https://example.com\"}", "navigation command");
        RejectCommand(new string(' ', 4097), "oversize command");
        using (var input = new StringReader(new string('x', 4097) + "\n{\"type\":\"close\"}\n"))
        {
            try { HostProtocol.ReadCommandLine(input); throw new Exception("oversize input line"); }
            catch (ArgumentException) { }
            Check(HostProtocol.ParseCommand(HostProtocol.ReadCommandLine(input)).Type == "close", "reader resumes after oversized line");
        }
        bool released = false;
        using (var content = new CompletedResponseStream(new byte[] { 1, 2 }, 2, stream => released = true))
        {
            var bytes = new byte[2];
            Check(content.Read(bytes, 0, 2) == 2 && bytes[0] == 1 && bytes[1] == 2, "response bytes");
            Check(content.Read(bytes, 0, 2) == 0, "repeat EOF read");
            Check(released, "response bytes released at EOF");
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
