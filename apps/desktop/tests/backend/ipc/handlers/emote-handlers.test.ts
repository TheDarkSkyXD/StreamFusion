import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: emote-handlers registers IPC channels EMOTES_7TV_GET_USER_BY_CONNECTION and EMOTES_7TV_GET_GLOBAL_EMOTE_SET, forwarding to fetch7TVUserByConnection / fetch7TVGlobalEmoteSet without transforming the result
// Guards: 404 from the service surfaces to the renderer as a null result (NOT a thrown error) — the renderer's ApiClient[error] line + DevTools red `Failed to load resource` are the symptoms we're fixing; the handler must preserve the null sentinel

const registryMock = vi.hoisted(() => ({
  handle: vi.fn(),
  internalError: vi.fn(() => ({
    kind: "error" as const,
    error: {
      code: "internal" as const,
      retry: { kind: "manual" as const },
      diagnosticId: "00000000-0000-4000-8000-000000000000",
    },
  })),
}));

const serviceMock = vi.hoisted(() => ({
  fetch7TVUserByConnection: vi.fn(),
  fetch7TVGlobalEmoteSet: vi.fn(),
  fetchBTTVBadges: vi.fn(),
  fetchBTTVGlobalEmotes: vi.fn(),
  fetchBTTVUserByTwitchId: vi.fn(),
  fetchFFZBadges: vi.fn(),
  fetchFFZGlobalEmotes: vi.fn(),
  fetchFFZRoom: vi.fn(),
  fetchKickChannelEmotes: vi.fn(),
  fetchKickUserSubscriptions: vi.fn(),
}));

vi.mock("@backend/services/emotes/7tv-emotes-service", () => ({
  fetch7TVUserByConnection: serviceMock.fetch7TVUserByConnection,
  fetch7TVGlobalEmoteSet: serviceMock.fetch7TVGlobalEmoteSet,
}));
vi.mock("@backend/services/emotes/bttv-emotes-service", () => ({
  fetchBTTVBadges: serviceMock.fetchBTTVBadges,
  fetchBTTVGlobalEmotes: serviceMock.fetchBTTVGlobalEmotes,
  fetchBTTVUserByTwitchId: serviceMock.fetchBTTVUserByTwitchId,
}));
vi.mock("@backend/services/emotes/ffz-emotes-service", () => ({
  fetchFFZBadges: serviceMock.fetchFFZBadges,
  fetchFFZGlobalEmotes: serviceMock.fetchFFZGlobalEmotes,
  fetchFFZRoom: serviceMock.fetchFFZRoom,
}));
vi.mock("@backend/services/emotes/kick-channel-emotes-service", () => ({
  fetchKickChannelEmotes: serviceMock.fetchKickChannelEmotes,
}));
vi.mock("@backend/services/emotes/kick-user-subscriptions-service", () => ({
  fetchKickUserSubscriptions: serviceMock.fetchKickUserSubscriptions,
}));

import { registerEmoteHandlers } from "@backend/ipc/handlers/emote-handlers";
import type { TrustedIpcRegistry } from "@backend/ipc/trusted-ipc-registry";
import { IPC_CHANNELS } from "@shared/ipc-channels";

function captureHandler(channel: string): (event: unknown, params: unknown) => Promise<unknown> {
  const call = registryMock.handle.mock.calls.find(([route]) => route.channel === channel);
  if (!call) throw new Error(`Handler for ${channel} was not registered`);
  const execute = call[0].execute as (event: unknown, params: unknown) => Promise<unknown>;
  return async (event, params) => {
    const reply = await execute(event, params);
    if (
      typeof reply === "object" &&
      reply !== null &&
      "kind" in reply &&
      reply.kind === "ok" &&
      "value" in reply
    ) {
      return reply.value;
    }
    return reply;
  };
}

describe("registerEmoteHandlers", () => {
  beforeEach(() => {
    registryMock.handle.mockReset();
    registryMock.internalError.mockClear();
    serviceMock.fetch7TVUserByConnection.mockReset();
    serviceMock.fetch7TVGlobalEmoteSet.mockReset();
    serviceMock.fetchBTTVBadges.mockReset();
    serviceMock.fetchBTTVGlobalEmotes.mockReset();
    serviceMock.fetchBTTVUserByTwitchId.mockReset();
    serviceMock.fetchFFZBadges.mockReset();
    serviceMock.fetchFFZGlobalEmotes.mockReset();
    serviceMock.fetchFFZRoom.mockReset();
    serviceMock.fetchKickChannelEmotes.mockReset();
    serviceMock.fetchKickUserSubscriptions.mockReset();
    registerEmoteHandlers(registryMock as unknown as TrustedIpcRegistry);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers both 7TV channels", () => {
    const registeredChannels = registryMock.handle.mock.calls.map(([route]) => route.channel);
    expect(registeredChannels).toContain(IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION);
    expect(registeredChannels).toContain(IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET);
  });

  it("forwards user-by-connection to the service and returns its result verbatim", async () => {
    const userJson = { id: "01HX2", emote_set: { id: "set1", emotes: [] } };
    serviceMock.fetch7TVUserByConnection.mockResolvedValue(userJson);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION);

    const result = await handler({}, { platform: "kick", identifier: "58371235" });

    expect(serviceMock.fetch7TVUserByConnection).toHaveBeenCalledWith("kick", "58371235");
    expect(result).toEqual(userJson);
  });

  it("returns the null sentinel from a 404 verbatim (no thrown error)", async () => {
    serviceMock.fetch7TVUserByConnection.mockResolvedValue(null);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION);

    const result = await handler({}, { platform: "kick", identifier: "58371235" });

    expect(result).toBeNull();
  });

  it("forwards global emote set to the service", async () => {
    const setJson = { id: "global", emotes: [{ id: "01F", name: "FeelsOkayMan" }] };
    serviceMock.fetch7TVGlobalEmoteSet.mockResolvedValue(setJson);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET);

    const result = await handler({}, undefined);

    expect(serviceMock.fetch7TVGlobalEmoteSet).toHaveBeenCalledOnce();
    expect(result).toEqual(setJson);
  });

  it("registers all BTTV + FFZ channels", () => {
    const registered = registryMock.handle.mock.calls.map(([route]) => route.channel);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_FFZ_GET_ROOM);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS);
  });

  it("forwards BTTV user-by-twitch-id and passes the null sentinel through", async () => {
    serviceMock.fetchBTTVUserByTwitchId.mockResolvedValue(null);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID);

    const result = await handler({}, { channelId: "71092938" });

    expect(serviceMock.fetchBTTVUserByTwitchId).toHaveBeenCalledWith("71092938");
    expect(result).toBeNull();
  });

  it("forwards the BTTV badge catalog without transforming it", async () => {
    const badges = [
      {
        providerId: "user123",
        badge: { description: "BTTV Developer", svg: "https://cdn.example/badge.svg" },
      },
    ];
    serviceMock.fetchBTTVBadges.mockResolvedValue(badges);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_BTTV_GET_BADGES);

    const result = await handler({}, undefined);

    expect(serviceMock.fetchBTTVBadges).toHaveBeenCalledOnce();
    expect(result).toEqual(badges);
  });

  it("forwards FFZ room with the original {name, channelId} opts", async () => {
    const room = { room: { _id: 1 }, sets: {} };
    serviceMock.fetchFFZRoom.mockResolvedValue(room);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_FFZ_GET_ROOM);

    const result = await handler({}, { kind: "name", name: "xqc" });

    expect(serviceMock.fetchFFZRoom).toHaveBeenCalledWith({ kind: "name", name: "xqc" });
    expect(result).toEqual(room);
  });

  it("forwards the FFZ badge catalog without transforming it", async () => {
    const catalog = {
      badges: [{ id: 1, title: "FFZ Developer", color: "#ff0000", urls: { "1": "one" } }],
      users: { "1": ["11111"] },
    };
    serviceMock.fetchFFZBadges.mockResolvedValue(catalog);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_FFZ_GET_BADGES);

    const result = await handler({}, undefined);

    expect(serviceMock.fetchFFZBadges).toHaveBeenCalledOnce();
    expect(result).toEqual(catalog);
  });

  it("forwards Kick channel-emote lookup and passes the null sentinel through", async () => {
    serviceMock.fetchKickChannelEmotes.mockResolvedValue(null);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES);

    const result = await handler({}, { slug: "missing-channel", accessToken: "token" });

    expect(serviceMock.fetchKickChannelEmotes).toHaveBeenCalledWith("missing-channel", "token");
    expect(result).toBeNull();
  });

  it("forwards Kick user subscriptions and passes the null sentinel through", async () => {
    serviceMock.fetchKickUserSubscriptions.mockResolvedValue(null);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS);

    const result = await handler({}, undefined);

    expect(serviceMock.fetchKickUserSubscriptions).toHaveBeenCalledOnce();
    expect(result).toBeNull();
  });
});
