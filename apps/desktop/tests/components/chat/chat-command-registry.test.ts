import {
  getCommandCompletion,
  getCommandsForAccess,
  parseAvailableCommand,
  replaceLeadingCommand,
} from "@/features/chat/utils/chat-command-registry";
import { getMentionRange } from "@/features/chat/components/chat/mention-completion";
import { describe, expect, it } from "vitest";

// Guards: command lists must retain viewer commands when moderator authority is added, and guests must not see account commands.
// Guards: platform-specific commands must not appear in the other platform's composer.
// Guards: unrecognized slash text must never become an ordinary chat message.
describe("chat command registry", () => {
  it("filters commands by platform and viewer-plus-moderator authority", () => {
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

  it("keeps mentions valid inside command arguments and rejects embedded email-like at signs", () => {
    expect(getMentionRange("/ban @viewer spam", 12)).toEqual({
      start: 5,
      end: 12,
      query: "viewer",
    });
    expect(getMentionRange("hello @viewer there", 10)).toEqual({
      start: 6,
      end: 13,
      query: "vie",
    });
    expect(getMentionRange("email@viewer", 12)).toBeNull();
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
