import { describe, expect, it } from "vitest";

import { parseRawTwitchIrcLine } from "@/backend/services/chat/twitch-irc-parser";

describe("parseRawTwitchIrcLine", () => {
  it("returns null for empty string", () => {
    expect(parseRawTwitchIrcLine("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(parseRawTwitchIrcLine("\r\n")).toBeNull();
  });

  it("returns null for non-PRIVMSG/USERNOTICE commands", () => {
    expect(parseRawTwitchIrcLine(":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!")).toBeNull();
    expect(parseRawTwitchIrcLine("PING :tmi.twitch.tv")).toBeNull();
  });

  it("parses a basic PRIVMSG with tags", () => {
    const line =
      "@badge-info=subscriber/8;badges=subscriber/6,premium/1;color=#FF4500;" +
      "display-name=TestUser;emotes=;id=abc-123;mod=0;room-id=12345;" +
      "subscriber=1;turbo=0;user-id=67890;user-type= " +
      ":testuser!testuser@testuser.tmi.twitch.tv PRIVMSG #somechannel :Hello world!";

    const result = parseRawTwitchIrcLine(line);

    expect(result).not.toBeNull();
    expect(result!.command).toBe("PRIVMSG");
    expect(result!.channel).toBe("somechannel");
    expect(result!.nick).toBe("testuser");
    expect(result!.message).toBe("Hello world!");
    expect(result!.tags["display-name"]).toBe("TestUser");
    expect(result!.tags.color).toBe("#FF4500");
    expect(result!.tags["user-id"]).toBe("67890");
    expect(result!.tags.id).toBe("abc-123");
  });

  it("parses badges into nested object", () => {
    const line =
      "@badges=moderator/1,subscriber/12 " + ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags.badges).toEqual({
      moderator: "1",
      subscriber: "12",
    });
  });

  it("parses badge-info into nested object", () => {
    const line =
      "@badge-info=subscriber/24;badges=subscriber/24 " +
      ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags["badge-info"]).toEqual({ subscriber: "24" });
  });

  it("parses emotes into position map", () => {
    const line =
      "@emotes=25:0-4,12-16/1902:18-20 " +
      ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :Kappa hello Kappa LUL";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags.emotes).toEqual({
      "25": ["0-4", "12-16"],
      "1902": ["18-20"],
    });
  });

  it("returns null emotes for empty emotes field", () => {
    const line = "@emotes= " + ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.tags.emotes).toBeNull();
  });

  it("coerces boolean tags from 0/1", () => {
    const line =
      "@mod=1;subscriber=0;turbo=1;first-msg=0;returning-chatter=1 " +
      ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags.mod).toBe(true);
    expect(result.tags.subscriber).toBe(false);
    expect(result.tags.turbo).toBe(true);
    expect(result.tags["first-msg"]).toBe(false);
    expect(result.tags["returning-chatter"]).toBe(true);
  });

  it("handles ACTION messages (strips envelope, sets message-type)", () => {
    const line =
      "@display-name=TestUser " +
      `:testuser!testuser@testuser.tmi.twitch.tv PRIVMSG #ch :\x01ACTION dances\x01`;

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.message).toBe("dances");
    expect(result.tags["message-type"]).toBe("action");
  });

  it("parses USERNOTICE (sub event)", () => {
    const line =
      "@badge-info=subscriber/1;badges=subscriber/0;color=#00FF00;" +
      "display-name=Gifter;id=xyz-789;login=gifter;mod=0;" +
      "msg-id=subgift;msg-param-months=1;msg-param-recipient-display-name=Lucky;" +
      "room-id=12345;subscriber=1;system-msg=Gifter\\sgifted\\sa\\sTier\\s1\\ssub\\sto\\sLucky!;" +
      "user-id=99999 " +
      ":tmi.twitch.tv USERNOTICE #somechannel";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.command).toBe("USERNOTICE");
    expect(result.channel).toBe("somechannel");
    expect(result.tags["msg-id"]).toBe("subgift");
    expect(result.tags["system-msg"]).toBe("Gifter gifted a Tier 1 sub to Lucky!");
    expect(result.message).toBe("");
  });

  it("unescapes IRCv3 tag values", () => {
    const line = "@system-msg=hello\\sworld\\:foo\\\\bar\\r\\n " + ":tmi.twitch.tv USERNOTICE #ch";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags["system-msg"]).toBe("hello world;foo\\bar\r\n");
  });

  it("handles unknown escape sequences by dropping the backslash", () => {
    const line = "@system-msg=test\\xvalue " + ":tmi.twitch.tv USERNOTICE #ch";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.tags["system-msg"]).toBe("testxvalue");
  });

  it("handles trailing lone backslash (dropped)", () => {
    const line = "@system-msg=trailing\\ " + ":tmi.twitch.tv USERNOTICE #ch";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.tags["system-msg"]).toBe("trailing");
  });

  it("backfills display-name from nick when tag is missing", () => {
    const line = "@color=#FF0000 " + ":someuser!someuser@someuser.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags["display-name"]).toBe("someuser");
  });

  it("does not overwrite display-name when tag is present", () => {
    const line =
      "@display-name=ProperName " +
      ":propername!propername@propername.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;

    expect(result.tags["display-name"]).toBe("ProperName");
  });

  it("handles empty badges field", () => {
    const line = "@badges= " + ":nick!nick@nick.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.tags.badges).toEqual({});
  });

  it("returns null when no space after source prefix", () => {
    expect(parseRawTwitchIrcLine(":no-space-here")).toBeNull();
  });

  it("returns null when channel doesn't start with #", () => {
    const line = ":nick!nick@nick.tmi.twitch.tv PRIVMSG nochannel :hi";
    expect(parseRawTwitchIrcLine(line)).toBeNull();
  });

  it("strips \\r\\n from end of line", () => {
    const line = "@display-name=Test " + ":test!test@test.tmi.twitch.tv PRIVMSG #ch :msg\r\n";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.message).toBe("msg");
  });

  it("handles PRIVMSG without trailing message", () => {
    const line = "@display-name=Test " + ":test!test@test.tmi.twitch.tv PRIVMSG #ch";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.message).toBe("");
    expect(result.channel).toBe("ch");
  });

  it("handles tags with no value (key-only)", () => {
    const line = "@emote-only;display-name=Test " + ":test!test@test.tmi.twitch.tv PRIVMSG #ch :hi";

    const result = parseRawTwitchIrcLine(line)!;
    expect(result.tags["emote-only"]).toBe("");
  });
});
