import {
  getCommandArgumentError,
  getCommandCompletion,
  getCommandsForAccess,
  parseAvailableCommand,
  replaceLeadingCommand,
} from "@/features/chat/utils/chat-command-registry";
import { describe, expect, it } from "vitest";

// Guards: command lists retain viewer commands when moderator authority is added, and guests do not see account commands.
// Guards: platform-specific commands do not appear in the other platform's composer.
// Guards: malformed and unrecognized slash text cannot reach an ordinary chat send.
describe("chat command registry", () => {
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

    expect(twitchViewer.map((command) => command.name)).toEqual(
      expect.arrayContaining(["block", "color", "help", "me", "mods", "vips"])
    );
    expect(twitchViewer.map((command) => command.name)).not.toContain("ban");
    expect(twitchModerator.map((command) => command.name)).toEqual(
      expect.arrayContaining(["block", "me", "ban", "timeout", "emoteonly"])
    );
    expect(twitchModerator.map((command) => command.name)).not.toContain("mod");
    expect(twitchBroadcaster.map((command) => command.name)).toEqual(
      expect.arrayContaining(["mod", "unmod", "vip", "unvip"])
    );
    expect(kickModerator.map((command) => command.name)).toEqual(
      expect.arrayContaining(["help", "me", "ban", "unban", "timeout", "slow", "followonly"])
    );
    expect(kickModerator.map((command) => command.name)).not.toContain("subonly");
    expect(kickBroadcaster.map((command) => command.name)).toContain("subonly");
    expect(getCommandsForAccess({ kind: "guest", platform: "twitch" })).toEqual([]);
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
      "/timeout needs a username and a positive number of seconds"
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
      "/timeout duration must be a positive whole number of seconds",
    ]);

    const followersForEveryone = parseAvailableCommand("/followers 0", twitchCommands);
    expect(followersForEveryone && getCommandArgumentError(followersForEveryone)).toBeNull();
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
