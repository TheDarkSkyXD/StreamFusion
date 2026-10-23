using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

sealed class PlayerOptions
{
    public string Channel;
    public IntPtr Owner;
    public int ParentPid;
    public string UserDataDir;
    public bool Muted;
}

sealed class PlayerCommand
{
    public string Type;
    public bool Muted;
    public string BaseUrl;
    public int Revision;
    public bool Visible;
    public double X, Y, Width, Height, ClipX, ClipY, ClipWidth, ClipHeight, Radius, Zoom;
    public string Presentation;
    public bool BlockerEnabled;
}

static class HostProtocol
{
    const int MaxLineLength = 4096;
    static readonly Regex ChannelPattern = new Regex(@"^[A-Za-z0-9_]{1,25}$", RegexOptions.CultureInvariant);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxLineLength };

    public static PlayerOptions TryParseOptions(string[] args)
    {
        if (args.Length != 10) throw new ArgumentException("Expected five launch options.");
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int i = 0; i < args.Length; i += 2)
        {
            if (values.ContainsKey(args[i])) throw new ArgumentException("Duplicate launch option.");
            values.Add(args[i], args[i + 1]);
        }
        string channel = Get(values, "--channel");
        string ownerText = Get(values, "--owner");
        string parentText = Get(values, "--parent-pid");
        string userDataDir = Get(values, "--user-data-dir");
        string mutedText = Get(values, "--muted");
        if (!ChannelPattern.IsMatch(channel)) throw new ArgumentException("Invalid channel.");
        ulong owner;
        int parentPid;
        if (!ulong.TryParse(ownerText, NumberStyles.None, CultureInfo.InvariantCulture, out owner) || owner == 0 || owner > long.MaxValue)
            throw new ArgumentException("Invalid owner handle.");
        if (!int.TryParse(parentText, NumberStyles.None, CultureInfo.InvariantCulture, out parentPid) || parentPid <= 0)
            throw new ArgumentException("Invalid parent process.");
        if (!Path.IsPathRooted(userDataDir) || !Regex.IsMatch(userDataDir, @"^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)", RegexOptions.CultureInvariant))
            throw new ArgumentException("Profile path must be absolute.");
        if (mutedText != "true" && mutedText != "false") throw new ArgumentException("Invalid mute value.");
        return new PlayerOptions {
            Channel = channel.ToLowerInvariant(), Owner = new IntPtr((long)owner), ParentPid = parentPid,
            UserDataDir = userDataDir, Muted = mutedText == "true"
        };
    }

    static string Get(Dictionary<string, string> values, string key)
    {
        string value;
        if (!values.TryGetValue(key, out value)) throw new ArgumentException("Missing " + key + ".");
        return value;
    }

    public static string BuildPlayerUrl()
    {
        return "https://streamfusion.test/src/frontend/features/playback/routes/protected-player.html";
    }

    public static PlayerCommand ParseCommand(string line)
    {
        if (line == null || line.Length > MaxLineLength) throw new ArgumentException("Invalid command length.");
        Dictionary<string, object> body;
        try { body = Json.Deserialize<Dictionary<string, object>>(line); }
        catch (Exception error) { throw new ArgumentException("Invalid command JSON.", error); }
        if (body == null) throw new ArgumentException("Invalid command body.");
        object typeValue;
        if (!body.TryGetValue("type", out typeValue) || !(typeValue is string))
            throw new ArgumentException("Missing command type.");
        string type = (string)typeValue;
        if (type == "focus" || type == "close" || type == "raise" || type == "suspend")
        {
            if (body.Count != 1) throw new ArgumentException("Unexpected command fields.");
            return new PlayerCommand { Type = type };
        }
        if (type == "mute")
        {
            object muted;
            if (body.Count != 2 || !body.TryGetValue("muted", out muted) || !(muted is bool))
                throw new ArgumentException("Invalid mute command.");
            return new PlayerCommand { Type = type, Muted = (bool)muted };
        }
        if (type == "session")
        {
            object baseUrl;
            if (body.Count != 2 || !body.TryGetValue("baseUrl", out baseUrl) || !(baseUrl is string) ||
                !Regex.IsMatch((string)baseUrl, @"^http://127\.0\.0\.1:[0-9]{2,5}/s/[a-f0-9]{64}$", RegexOptions.CultureInvariant))
                throw new ArgumentException("Invalid session command.");
            return new PlayerCommand { Type = type, BaseUrl = (string)baseUrl };
        }
        if (type == "present")
        {
            object revision, visible;
            if (!body.TryGetValue("revision", out revision) || !(revision is int) || (int)revision < 0 ||
                !body.TryGetValue("visible", out visible) || !(visible is bool))
                throw new ArgumentException("Invalid presentation header.");
            var command = new PlayerCommand { Type = type, Revision = (int)revision, Visible = (bool)visible };
            if (!command.Visible)
            {
                if (body.Count != 3) throw new ArgumentException("Unexpected hidden presentation fields.");
                return command;
            }
            if (body.Count != 15) throw new ArgumentException("Invalid visible presentation fields.");
            command.X = Number(body, "x", -16384, 16384);
            command.Y = Number(body, "y", -16384, 16384);
            command.Width = Number(body, "width", 0.01, 16384);
            command.Height = Number(body, "height", 0.01, 16384);
            command.ClipX = Number(body, "clipX", 0, 16384);
            command.ClipY = Number(body, "clipY", 0, 16384);
            command.ClipWidth = Number(body, "clipWidth", 0.01, 16384);
            command.ClipHeight = Number(body, "clipHeight", 0.01, 16384);
            command.Radius = Number(body, "radius", 0, 256);
            command.Zoom = Number(body, "zoom", 0.25, 5);
            object presentation, blockerEnabled;
            if (!body.TryGetValue("presentation", out presentation) || !(presentation is string) ||
                ((string)presentation != "docked" && (string)presentation != "theater" && (string)presentation != "mini") ||
                !body.TryGetValue("blockerEnabled", out blockerEnabled) || !(blockerEnabled is bool) ||
                command.ClipX + command.ClipWidth > command.Width + 0.001 ||
                command.ClipY + command.ClipHeight > command.Height + 0.001)
                throw new ArgumentException("Invalid visible presentation.");
            command.Presentation = (string)presentation;
            command.BlockerEnabled = (bool)blockerEnabled;
            return command;
        }
        throw new ArgumentException("Unknown command.");
    }

    static double Number(Dictionary<string, object> body, string key, double minimum, double maximum)
    {
        object raw;
        if (!body.TryGetValue(key, out raw) || raw is bool || raw is string || raw == null)
            throw new ArgumentException("Invalid " + key + ".");
        double value;
        try { value = Convert.ToDouble(raw, CultureInfo.InvariantCulture); }
        catch (Exception) { throw new ArgumentException("Invalid " + key + "."); }
        if (Double.IsNaN(value) || Double.IsInfinity(value) || value < minimum || value > maximum)
            throw new ArgumentException("Invalid " + key + ".");
        return value;
    }

    public static string ReadCommandLine(TextReader reader)
    {
        var line = new StringBuilder();
        bool tooLong = false;
        while (true)
        {
            int next = reader.Read();
            if (next == -1 && line.Length == 0 && !tooLong) return null;
            if (next == -1 || next == '\n')
            {
                if (tooLong) throw new ArgumentException("Command line is too long.");
                return line.ToString().TrimEnd('\r');
            }
            if (line.Length == MaxLineLength) tooLong = true;
            if (!tooLong) line.Append((char)next);
        }
    }

    public static string Event(string type, string message)
    {
        var record = new Dictionary<string, object> { { "type", type } };
        if (message != null) record.Add("message", message);
        return Json.Serialize(record);
    }
}
