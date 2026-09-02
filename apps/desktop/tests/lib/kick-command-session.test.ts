import {
  getCommandsForAccess,
  type KickCommandDefinition,
} from "@/features/chat/utils/chat-command-registry";
import {
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
    role: "broadcaster",
    sendAction: vi.fn(async () => {}),
    moderate: vi.fn(async () => {}),
  } satisfies KickCommandSessionDependencies;
}

// Guards: local Kick commands dispatch locally and unsupported workflows report inside StreamFusion.
// Guards: no Kick slash command opens an external page.
describe("Kick command session", () => {
  it("dispatches local actions without opening Kick", async () => {
    const deps = dependencies();

    const outcome = await runKickCommandEffect(broadcasterCommand("me"), "waves", deps);

    expect(deps.sendAction).toHaveBeenCalledWith("waves");
    expect(outcome).toEqual({ kind: "handled" });
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
  });

  it("reports first-party-only commands without opening Kick", async () => {
    const deps = dependencies();

    const outcome = await runKickCommandEffect(broadcasterCommand("title"), "New title", deps);

    expect(outcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "/title",
        body: "Kick only documents programmatic title changes for the channel owner's token.",
      },
    });
  });
});
