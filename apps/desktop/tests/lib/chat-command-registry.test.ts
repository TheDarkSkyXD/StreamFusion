import {
  CHAT_COMMAND_REGISTRY,
  compileKickCommand,
  compileTwitchCommand,
  getCommandArgumentError,
  getCommandCompletion,
  getCommandsForAccess,
  parseAvailableCommand,
  replaceLeadingCommand,
  KICK_LINKED_COMMAND_NAMES,
  TWITCH_LINKED_COMMAND_NAMES,
} from "@/features/chat/utils/chat-command-registry";
import { activateDisplayLanguage, i18n } from "@/i18n";
import { describe, expect, it } from "vitest";

// Guards: command lists retain viewer commands when moderator authority is added, and guests do not see account commands.
// Guards: platform-specific commands do not appear in the other platform's composer.
// Guards: malformed and unrecognized slash text cannot reach an ordinary chat send.
// Guards: Kick's official 23-command catalog retains exact role and argument contracts.
// Guards: unsupported provider workflows compile to renderer-local notices instead of external page handoffs.
// Guards: command descriptions resolve when read so a display-language change cannot leave frozen English copy.
describe("chat command registry", () => {
  const linkedNames = [
    "mods",
    "vips",
    "color",
    "w",
    "block",
    "unblock",
    "disconnect",
    "gift",
    "vote",
    "timeout",
    "ban",
    "unban",
    "clear",
    "followers",
    "followersoff",
    "slow",
    "slowoff",
    "subscribers",
    "subscribersoff",
    "emoteonly",
    "emoteonlyoff",
    "uniquechat",
    "uniquechatoff",
    "pin",
    "announce",
    "shoutout",
    "monitor",
    "unmonitor",
    "restrict",
    "unrestrict",
    "user",
    "requests",
    "poll",
    "endpoll",
    "deletepoll",
    "mod",
    "unmod",
    "vip",
    "unvip",
    "rules",
    "sharedchat",
    "commercial",
    "goal",
    "prediction",
    "raid",
    "unraid",
    "marker",
  ];
  const kickLinkedNames = [
    "ban",
    "unban",
    "timeout",
    "clear",
    "mod",
    "unmod",
    "user",
    "slow",
    "followonly",
    "subonly",
    "emoteonly",
    "title",
    "category",
    "raid",
    "og",
    "unog",
    "vip",
    "unvip",
    "poll",
    "polldelete",
    "prediction",
    "multi",
    "kpp",
  ];

  it("matches the linked 47-command Twitch catalog exactly", () => {
    expect(TWITCH_LINKED_COMMAND_NAMES).toHaveLength(47);
    expect([...TWITCH_LINKED_COMMAND_NAMES].sort()).toEqual([...linkedNames].sort());
    expect(new Set(CHAT_COMMAND_REGISTRY.map((command) => command.id)).size).toBe(
      CHAT_COMMAND_REGISTRY.length
    );
    expect(
      CHAT_COMMAND_REGISTRY.filter((command) => command.platform === "twitch")
        .map((command) => command.name)
        .filter((name) => !linkedNames.includes(name))
        .sort()
    ).toEqual(["help", "me"]);
  });

  it("compiles every Twitch command and keeps me as the only IRC effect", () => {
    const sampleArgs: Record<string, string> = {
      color: "blue",
      w: "@friend hello",
      block: "@friend",
      unblock: "friend",
      gift: "5",
      timeout: "friend",
      ban: "friend spam",
      unban: "friend",
      followers: "2h",
      slow: "30",
      pin: "Pinned update",
      announce: "Channel update",
      shoutout: "friend",
      monitor: "friend",
      unmonitor: "friend",
      restrict: "friend",
      unrestrict: "friend",
      user: "friend",
      mod: "friend",
      unmod: "friend",
      vip: "friend",
      unvip: "friend",
      commercial: "60",
      raid: "friend",
      marker: "Great play",
      me: "waves",
    };
    const effects = CHAT_COMMAND_REGISTRY.filter((command) => command.platform === "twitch").map(
      (definition) =>
        compileTwitchCommand(
          {
            definition,
            args: sampleArgs[definition.name] ?? "",
            text: `/${definition.name}`,
          },
          definition.allowedRoles.includes("broadcaster") ? "broadcaster" : "viewer"
        )
    );

    expect(effects.filter((effect) => effect.kind === "irc-action")).toHaveLength(1);
    expect(effects.find((effect) => effect.kind === "irc-action")).toEqual({
      kind: "irc-action",
      message: "waves",
    });
    expect(effects.filter((effect) => effect.kind === "channel-members")).toEqual([
      { kind: "channel-members", list: "moderators" },
      { kind: "channel-members", list: "vips" },
    ]);
    expect(effects.filter((effect) => effect.kind === "local-notice")).toHaveLength(9);
  });

  it("matches and compiles the linked 23-command Kick catalog exactly", () => {
    expect(KICK_LINKED_COMMAND_NAMES).toHaveLength(23);
    expect([...KICK_LINKED_COMMAND_NAMES].sort()).toEqual([...kickLinkedNames].sort());
    expect(
      CHAT_COMMAND_REGISTRY.filter((command) => command.platform === "kick")
        .map((command) => command.name)
        .filter((name) => !kickLinkedNames.includes(name))
        .sort()
    ).toEqual(["help", "me"]);

    const broadcaster = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "broadcaster",
      isPartnerBroadcaster: true,
    });
    const sampleArgs: Record<string, string> = {
      ban: "viewer spam",
      unban: "viewer",
      timeout: "viewer 600 cool down",
      mod: "viewer",
      unmod: "viewer",
      user: "viewer",
      slow: "on 30",
      followonly: "on",
      subonly: "on",
      emoteonly: "off",
      title: "New stream title",
      og: "viewer",
      unog: "viewer",
      vip: "viewer",
      unvip: "viewer",
      multi: "on",
      kpp: "off",
      me: "waves",
    };
    const effects = broadcaster.map((definition) =>
      compileKickCommand(
        {
          definition,
          args: sampleArgs[definition.name] ?? "",
          text: `/${definition.name}`,
        },
        "broadcaster"
      )
    );

    expect(effects.filter((effect) => effect.kind === "moderation")).toHaveLength(3);
    expect(effects.filter((effect) => effect.kind === "local-notice")).toHaveLength(20);
  });
  it("filters commands by platform and role", () => {
    const twitchViewer = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "viewer",
    });
    const twitchModerator = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const twitchBroadcaster = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "broadcaster",
    });
    const kickModerator = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    });
    const kickBroadcaster = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "broadcaster",
    });
    const kickPartnerBroadcaster = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "broadcaster",
      isPartnerBroadcaster: true,
    });
    const kickViewer = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "viewer",
    });

    expect(twitchViewer.map((command) => command.name)).toEqual(
      expect.arrayContaining(["block", "color", "help", "me", "mods", "vips"])
    );
    expect(twitchViewer.map((command) => command.name)).toEqual([
      "mods",
      "vips",
      "color",
      "w",
      "block",
      "unblock",
      "disconnect",
      "gift",
      "vote",
      "help",
      "me",
    ]);
    expect(twitchViewer.map((command) => command.name)).not.toContain("ban");
    expect(twitchModerator.map((command) => command.name)).toEqual(
      expect.arrayContaining(["block", "me", "ban", "timeout", "emoteonly"])
    );
    expect(twitchModerator.map((command) => command.name)).not.toContain("mod");
    expect(twitchModerator).toHaveLength(38);
    expect(twitchBroadcaster.map((command) => command.name)).toEqual(
      expect.arrayContaining(["mod", "unmod", "vip", "unvip"])
    );
    expect(twitchBroadcaster).toHaveLength(49);
    expect(kickModerator.map((command) => command.name)).toEqual(
      expect.arrayContaining([
        "help",
        "me",
        "ban",
        "unban",
        "timeout",
        "clear",
        "slow",
        "followonly",
        "title",
        "poll",
      ])
    );
    expect(kickModerator.map((command) => command.name)).not.toContain("subonly");
    expect(kickPartnerBroadcaster.map((command) => command.name)).toEqual(
      expect.arrayContaining(["subonly", "mod", "raid", "vip", "multi", "kpp"])
    );
    expect(kickBroadcaster.map((command) => command.name)).not.toEqual(
      expect.arrayContaining(["multi", "kpp"])
    );
    expect(kickViewer.map((command) => command.name)).toEqual(["help", "me"]);
    expect(kickModerator.map((command) => command.name)).toEqual([
      "help",
      "me",
      "ban",
      "unban",
      "timeout",
      "clear",
      "user",
      "slow",
      "followonly",
      "emoteonly",
      "title",
      "category",
      "poll",
      "polldelete",
      "prediction",
    ]);
    expect(kickBroadcaster).toHaveLength(23);
    expect(kickPartnerBroadcaster).toHaveLength(25);
    expect(getCommandsForAccess({ kind: "guest", platform: "twitch" })).toEqual([]);
  });

  it("updates command descriptions after the display language changes", async () => {
    await activateDisplayLanguage("en");
    const english = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "viewer",
    }).find((command) => command.name === "mods")?.description;

    try {
      await activateDisplayLanguage("es");
      const spanish = getCommandsForAccess({
        kind: "authenticated",
        platform: "twitch",
        role: "viewer",
      }).find((command) => command.name === "mods")?.description;
      expect(spanish).not.toBe(english);
      expect(i18n.resolvedLanguage).toBe("es");
    } finally {
      await activateDisplayLanguage("en");
    }
  });

  it("filters prefixes and replaces only the leading slash token", () => {
    const commands = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const completion = getCommandCompletion("/ti reason", 3, commands);

    expect(completion?.items.map((command) => command.name)).toEqual(["timeout"]);
    expect(replaceLeadingCommand("/ti reason", completion!.range, "timeout")).toBe(
      "/timeout reason"
    );
  });

  it("rejects missing required arguments", () => {
    const twitchCommands = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const kickCommands = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    });

    const twitchBan = parseAvailableCommand("/ban", twitchCommands);
    const kickTimeout = parseAvailableCommand("/timeout viewer", kickCommands);
    expect(twitchBan && getCommandArgumentError(twitchBan)).toBe("/ban needs a username");
    expect(kickTimeout && getCommandArgumentError(kickTimeout)).toBe(
      "/timeout needs a positive whole number of seconds"
    );
  });

  it("rejects invalid Twitch and Kick command durations", () => {
    const twitchCommands = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const kickCommands = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    });

    const invalidCommands = [
      parseAvailableCommand("/timeout viewer nope", twitchCommands),
      parseAvailableCommand("/timeout viewer 999999999999999999999999999", twitchCommands),
      parseAvailableCommand("/slow 2", twitchCommands),
      parseAvailableCommand("/followers 129601", twitchCommands),
      parseAvailableCommand("/timeout viewer 1.5", kickCommands),
    ];

    expect(invalidCommands.map((command) => command && getCommandArgumentError(command))).toEqual([
      "/timeout duration must be between 1 and 1209600 seconds",
      "/timeout duration must be between 1 and 1209600 seconds",
      "/slow duration must be between 3 and 120 seconds",
      "/followers duration must be between 0 and 129600 minutes",
      "/timeout needs a positive whole number of seconds",
    ]);

    const followersForEveryone = parseAvailableCommand("/followers 0", twitchCommands);
    expect(followersForEveryone && getCommandArgumentError(followersForEveryone)).toBeNull();
  });

  it("normalizes Twitch defaults, units, and leading at-sign usernames", () => {
    const moderator = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const timeout = parseAvailableCommand("/timeout @viewer", moderator)!;
    const followers = parseAvailableCommand("/followers 3mo", moderator)!;
    const slow = parseAvailableCommand("/slow", moderator)!;

    expect(compileTwitchCommand(timeout, "moderator")).toMatchObject({
      kind: "api",
      action: { targetLogin: "viewer", durationSeconds: 600 },
    });
    expect(compileTwitchCommand(followers, "moderator")).toMatchObject({
      action: { settings: { follower_mode_duration: 129_600 } },
    });
    expect(compileTwitchCommand(slow, "moderator")).toMatchObject({
      action: { settings: { slow_mode_wait_time: 30 } },
    });
  });

  it("routes a known moderator prediction command to a private local notice", () => {
    const moderator = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const prediction = parseAvailableCommand("/prediction", moderator)!;

    expect(compileTwitchCommand(prediction, "moderator")).toMatchObject({
      kind: "local-notice",
      message:
        "Twitch's public predictions mutations require the broadcaster's token, so StreamFusion does not run this moderator command from chat.",
    });
  });

  it("normalizes native Twitch color names and validates custom hex colors", () => {
    const viewer = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "viewer",
    });
    const named = parseAvailableCommand("/color DodgerBlue", viewer)!;
    const custom = parseAvailableCommand("/color #aabbcc", viewer)!;
    const invalid = parseAvailableCommand("/color ultraviolet", viewer)!;

    expect(compileTwitchCommand(named, "viewer")).toMatchObject({
      action: { color: "dodger_blue" },
    });
    expect(compileTwitchCommand(custom, "viewer")).toMatchObject({
      action: { color: "#AABBCC" },
    });
    expect(getCommandArgumentError(invalid)).toBe(
      "/color needs a supported Twitch color or six-digit hex value"
    );
  });

  it("rejects moderation reasons above Twitch's 500-character boundary", () => {
    const moderator = getCommandsForAccess({
      kind: "authenticated",
      platform: "twitch",
      role: "moderator",
    });
    const accepted = parseAvailableCommand(`/ban viewer ${"a".repeat(500)}`, moderator)!;
    const rejectedBan = parseAvailableCommand(`/ban viewer ${"a".repeat(501)}`, moderator)!;
    const rejectedTimeout = parseAvailableCommand(
      `/timeout viewer 600 ${"a".repeat(501)}`,
      moderator
    )!;

    expect(getCommandArgumentError(accepted)).toBeNull();
    expect(getCommandArgumentError(rejectedBan)).toBe(
      "/ban reason must be 500 characters or fewer"
    );
    expect(getCommandArgumentError(rejectedTimeout)).toBe(
      "/timeout reason must be 500 characters or fewer"
    );
  });

  it("validates Kick toggles, no-argument workflows, and moderation reasons", () => {
    const moderator = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "moderator",
    });
    const broadcaster = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "broadcaster",
      isPartnerBroadcaster: true,
    });
    const invalid = [
      parseAvailableCommand("/slow on", moderator),
      parseAvailableCommand("/slow off 30", moderator),
      parseAvailableCommand("/followonly maybe", moderator),
      parseAvailableCommand("/category games", moderator),
      parseAvailableCommand(`/ban viewer ${"a".repeat(101)}`, moderator),
      parseAvailableCommand("/timeout viewer 61", moderator),
      parseAvailableCommand("/multi sometimes", broadcaster),
    ];

    expect(invalid.map((command) => command && getCommandArgumentError(command))).toEqual([
      "/slow on needs a positive whole number of seconds",
      "/slow off does not accept arguments",
      "/followonly needs “on” or “off”",
      "/category does not accept arguments",
      "/ban reason must be 100 characters or fewer",
      "/timeout seconds must be a multiple of 60 between 60 and 604800",
      "/multi needs “on” or “off”",
    ]);
  });

  it("does not resolve unknown slash text for any send path", () => {
    const commands = getCommandsForAccess({
      kind: "authenticated",
      platform: "kick",
      role: "viewer",
    });

    expect(parseAvailableCommand("/clear", commands)).toBeNull();
    expect(parseAvailableCommand("/me hello", commands)?.definition.execution).toBe(
      "action-message"
    );
  });
});
