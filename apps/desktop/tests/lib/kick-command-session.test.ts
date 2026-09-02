import {
  getCommandsForAccess,
  type KickCommandDefinition,
} from "@/features/chat/utils/chat-command-registry";
import {
  getKickFirstPartyUrl,
  runKickCommandEffect,
  type KickCommandSessionDependencies,
} from "@/features/chat/utils/kick-command-session";
import { describe, expect, it, vi } from "vitest";

function broadcasterCommand(name: string): KickCommandDefinition {
  const definition = getCommandsForAccess({
    kind: "authenticated",
    platform: "kick",
    role: "broadcaster",
    isPartnerBroadcaster: true,
  }).find((command) => command.name === name);
  if (!definition || definition.platform !== "kick") {
    throw new Error(`Missing Kick command: ${name}`);
  }
  return definition;
}

function dependencies() {
  return {
    channelLogin: "XQC",
    role: "broadcaster",
    sendAction: vi.fn(async () => {}),
    moderate: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    explainHandoff: vi.fn(),
  } satisfies KickCommandSessionDependencies;
}

// Guards: local Kick commands dispatch locally and platform commands use the first-party channel.
describe("Kick command session", () => {
  it("builds allowlisted first-party destinations", () => {
    expect(getKickFirstPartyUrl({ kind: "channel-chat" }, "XQC")).toBe("https://kick.com/xqc");
  });

  it("dispatches local actions without opening Kick", async () => {
    const deps = dependencies();

    await runKickCommandEffect(broadcasterCommand("me"), "waves", deps);

    expect(deps.sendAction).toHaveBeenCalledWith("waves");
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it("dispatches documented moderation effects without sending raw slash text", async () => {
    const deps = dependencies();

    await runKickCommandEffect(broadcasterCommand("ban"), "@viewer spam", deps);

    expect(deps.moderate).toHaveBeenCalledWith({
      kind: "moderation",
      action: "ban",
      targetLogin: "viewer",
      reason: "spam",
    });
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it("opens Kick for first-party-only commands", async () => {
    const deps = dependencies();

    await runKickCommandEffect(broadcasterCommand("title"), "New title", deps);

    expect(deps.explainHandoff).toHaveBeenCalledWith(
      "Kick only documents programmatic title changes for the channel owner's token."
    );
    expect(deps.openExternal).toHaveBeenCalledWith("https://kick.com/xqc");
  });

  it("surfaces first-party launch failures", async () => {
    const deps = dependencies();
    deps.openExternal.mockRejectedValueOnce(new Error("Kick unavailable"));

    await expect(
      runKickCommandEffect(broadcasterCommand("title"), "New title", deps)
    ).rejects.toThrow("Kick unavailable");
  });
});
