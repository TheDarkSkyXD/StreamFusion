import {
  getCommandsForAccess,
  type TwitchCommandDefinition,
} from "@/features/chat/utils/chat-command-registry";
import {
  getTwitchFirstPartyUrl,
  runTwitchCommandEffect,
} from "@/features/chat/utils/twitch-command-session";
import type { TwitchApiResult } from "@shared/twitch-api-types";
import { describe, expect, it, vi } from "vitest";

// Guards: each closed Twitch command effect reaches only its intended renderer or IPC capability.
// Guards: API rejection and missing OAuth scopes reject execution so ChatInput restores the submitted draft.
// Guards: first-party URLs encode logins and fall back to the channel when Twitch rejects a dashboard URL.
describe("Twitch command session", () => {
  const commands = getCommandsForAccess({
    kind: "authenticated",
    platform: "twitch",
    role: "broadcaster",
  });
  const definition = (name: string): TwitchCommandDefinition => {
    const command = commands.find((candidate) => candidate.name === name);
    if (!command || command.platform !== "twitch") throw new Error(`Missing /${name}`);
    return command;
  };
  const dependencies = () => ({
    channel: { id: "100", login: "streamer" },
    role: "broadcaster" as const,
    grantedScopes: ["chat:edit", "user:manage:chat_color", "moderator:manage:banned_users"],
    sendAction: vi.fn(async () => undefined),
    leaveChannel: vi.fn(async () => undefined),
    executeApi: vi.fn(async (): Promise<TwitchApiResult> => ({
      ok: true,
      data: { action: "ban" },
    })),
    openExternal: vi.fn(async () => undefined),
    openEngagement: vi.fn(),
    requestReconnect: vi.fn(),
    explainHandoff: vi.fn(),
  });

  it("runs IRC, disconnect, API, engagement, first-party, and reconnect effects", async () => {
    const ports = dependencies();

    await runTwitchCommandEffect(definition("me"), "waves", ports);
    await runTwitchCommandEffect(definition("disconnect"), "", ports);
    await runTwitchCommandEffect(definition("color"), "blue", ports);
    await runTwitchCommandEffect(definition("poll"), "", ports);
    await runTwitchCommandEffect(definition("gift"), "5", ports);

    expect(ports.sendAction).toHaveBeenCalledWith("waves");
    expect(ports.leaveChannel).toHaveBeenCalledOnce();
    expect(ports.executeApi).toHaveBeenCalledWith({
      operation: "execute-slash-command",
      channel: { id: "100", login: "streamer" },
      action: { kind: "update-chat-color", color: "blue" },
    });
    expect(ports.openEngagement).toHaveBeenCalledWith("polls");
    expect(ports.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/subs/streamer");
    expect(ports.explainHandoff).toHaveBeenCalled();

    ports.grantedScopes.splice(0);
    await expect(runTwitchCommandEffect(definition("ban"), "viewer", ports)).rejects.toThrow(
      "Reconnect Twitch"
    );
    expect(ports.requestReconnect).toHaveBeenCalledWith(["moderator:manage:banned_users"]);
  });

  it("propagates semantic API rejection to the composer", async () => {
    const ports = dependencies();
    ports.executeApi.mockResolvedValueOnce({
      ok: false,
      error: { code: "unavailable", message: "Twitch rejected the command" },
    });

    await expect(runTwitchCommandEffect(definition("color"), "blue", ports)).rejects.toThrow(
      "Twitch rejected the command"
    );
  });

  it("builds only central Twitch first-party destinations", () => {
    expect(getTwitchFirstPartyUrl({ kind: "user", login: "Some_User" }, "streamer")).toBe(
      "https://www.twitch.tv/some_user"
    );
    expect(getTwitchFirstPartyUrl({ kind: "channel-chat" }, "Some_User")).toBe(
      "https://www.twitch.tv/popout/some_user/chat?popout="
    );
  });

  it("opens the channel fallback when a preferred Twitch destination fails", async () => {
    const ports = dependencies();
    ports.openExternal.mockRejectedValueOnce(new Error("dashboard unavailable"));

    await runTwitchCommandEffect(definition("sharedchat"), "", ports);

    expect(ports.openExternal.mock.calls).toEqual([
      ["https://dashboard.twitch.tv/u/streamer/stream-manager"],
      ["https://www.twitch.tv/streamer"],
    ]);
  });
});
