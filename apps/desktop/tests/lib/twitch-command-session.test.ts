import {
  getCommandsForAccess,
  type TwitchCommandDefinition,
} from "@/features/chat/utils/chat-command-registry";
import { runTwitchCommandEffect } from "@/features/chat/utils/twitch-command-session";
import type { TwitchApiResult, TwitchChannelMember } from "@shared/twitch-api-types";
import { describe, expect, it, vi } from "vitest";

type TwitchChannelMembersPage = {
  readonly data: readonly TwitchChannelMember[];
  readonly pagination: { readonly cursor?: string };
};

// Guards: each closed Twitch command effect reaches only its intended renderer or IPC capability.
// Guards: API rejection and missing OAuth scopes reject execution so ChatInput restores the submitted draft.
// Guards: Twitch-owned workflows report a renderer-local result and never open an external page.
// Guards: roster commands use the typed Twitch API so VIP and moderator results can stay in StreamFusion.
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
    readChannelMembers: vi.fn(async (): Promise<TwitchApiResult<TwitchChannelMembersPage>> => ({
      ok: true,
      data: {
        data: [
          { user_id: "1", user_login: "vip_one", user_name: "Vip One" },
          { user_id: "2", user_login: "vip_two", user_name: "" },
        ],
        pagination: {},
      },
    })),
    openEngagement: vi.fn(),
    requestReconnect: vi.fn(),
  });

  it("runs IRC, disconnect, API, engagement, local notice, and reconnect effects", async () => {
    const ports = dependencies();

    await runTwitchCommandEffect(definition("me"), "waves", ports);
    await runTwitchCommandEffect(definition("disconnect"), "", ports);
    await runTwitchCommandEffect(definition("color"), "blue", ports);
    await runTwitchCommandEffect(definition("poll"), "", ports);
    const giftOutcome = await runTwitchCommandEffect(definition("gift"), "5", ports);
    const vipOutcome = await runTwitchCommandEffect(definition("vips"), "", ports);

    expect(ports.sendAction).toHaveBeenCalledWith("waves");
    expect(ports.leaveChannel).toHaveBeenCalledOnce();
    expect(ports.executeApi).toHaveBeenCalledWith({
      operation: "execute-slash-command",
      channel: { id: "100", login: "streamer" },
      action: { kind: "update-chat-color", color: "blue" },
    });
    expect(ports.openEngagement).toHaveBeenCalledWith("polls");
    expect(giftOutcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "/gift",
        body: "Twitch handles gift purchases in its secure subscription flow.",
      },
    });
    expect(ports.readChannelMembers).toHaveBeenCalledWith("vips");
    expect(vipOutcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "Channel VIPs",
        body: "VIPs: Vip One, vip_two",
      },
    });

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

  it("shows Twitch member-list failures privately instead of restoring the slash draft", async () => {
    const ports = dependencies();
    ports.readChannelMembers.mockResolvedValueOnce({
      ok: false,
      error: { code: "unauthorized", message: "Missing scope: moderator:read:vips" },
    });

    const outcome = await runTwitchCommandEffect(definition("vips"), "", ports);

    expect(outcome).toEqual({
      kind: "local-result",
      result: {
        tone: "error",
        title: "Channel VIPs",
        body: "Missing scope: moderator:read:vips",
      },
    });
  });

  it("formats empty moderator rosters as a local result", async () => {
    const ports = dependencies();
    ports.readChannelMembers.mockResolvedValueOnce({
      ok: true,
      data: { data: [], pagination: {} },
    });

    const outcome = await runTwitchCommandEffect(definition("mods"), "", ports);

    expect(ports.readChannelMembers).toHaveBeenCalledWith("moderators");
    expect(outcome).toEqual({
      kind: "local-result",
      result: {
        tone: "info",
        title: "Channel moderators",
        body: "No moderators found for this channel.",
      },
    });
  });
});
