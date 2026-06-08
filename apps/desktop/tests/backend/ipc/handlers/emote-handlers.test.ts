import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: emote-handlers registers IPC channels EMOTES_7TV_GET_USER_BY_CONNECTION and EMOTES_7TV_GET_GLOBAL_EMOTE_SET, forwarding to fetch7TVUserByConnection / fetch7TVGlobalEmoteSet without transforming the result
// Guards: 404 from the service surfaces to the renderer as a null result (NOT a thrown error) — the renderer's ApiClient[error] line + DevTools red `Failed to load resource` are the symptoms we're fixing; the handler must preserve the null sentinel

const ipcMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: ipcMock,
}));

const serviceMock = vi.hoisted(() => ({
  fetch7TVUserByConnection: vi.fn(),
  fetch7TVGlobalEmoteSet: vi.fn(),
  fetchBTTVGlobalEmotes: vi.fn(),
  fetchBTTVUserByTwitchId: vi.fn(),
  fetchFFZGlobalEmotes: vi.fn(),
  fetchFFZRoom: vi.fn(),
}));

vi.mock("@/backend/services/emotes/7tv-emotes-service", () => ({
  fetch7TVUserByConnection: serviceMock.fetch7TVUserByConnection,
  fetch7TVGlobalEmoteSet: serviceMock.fetch7TVGlobalEmoteSet,
}));
vi.mock("@/backend/services/emotes/bttv-emotes-service", () => ({
  fetchBTTVGlobalEmotes: serviceMock.fetchBTTVGlobalEmotes,
  fetchBTTVUserByTwitchId: serviceMock.fetchBTTVUserByTwitchId,
}));
vi.mock("@/backend/services/emotes/ffz-emotes-service", () => ({
  fetchFFZGlobalEmotes: serviceMock.fetchFFZGlobalEmotes,
  fetchFFZRoom: serviceMock.fetchFFZRoom,
}));

import { registerEmoteHandlers } from "@/backend/ipc/handlers/emote-handlers";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

function captureHandler(channel: string): (event: unknown, params: unknown) => Promise<unknown> {
  const call = ipcMock.handle.mock.calls.find(([c]) => c === channel);
  if (!call) throw new Error(`Handler for ${channel} was not registered`);
  return call[1] as (event: unknown, params: unknown) => Promise<unknown>;
}

describe("registerEmoteHandlers", () => {
  beforeEach(() => {
    ipcMock.handle.mockReset();
    serviceMock.fetch7TVUserByConnection.mockReset();
    serviceMock.fetch7TVGlobalEmoteSet.mockReset();
    registerEmoteHandlers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers both 7TV channels", () => {
    const registeredChannels = ipcMock.handle.mock.calls.map(([c]) => c);
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
    const registered = ipcMock.handle.mock.calls.map(([c]) => c);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL);
    expect(registered).toContain(IPC_CHANNELS.EMOTES_FFZ_GET_ROOM);
  });

  it("forwards BTTV user-by-twitch-id and passes the null sentinel through", async () => {
    serviceMock.fetchBTTVUserByTwitchId.mockResolvedValue(null);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID);

    const result = await handler({}, { channelId: "71092938" });

    expect(serviceMock.fetchBTTVUserByTwitchId).toHaveBeenCalledWith("71092938");
    expect(result).toBeNull();
  });

  it("forwards FFZ room with the original {name, channelId} opts", async () => {
    const room = { room: { _id: 1 }, sets: {} };
    serviceMock.fetchFFZRoom.mockResolvedValue(room);
    const handler = captureHandler(IPC_CHANNELS.EMOTES_FFZ_GET_ROOM);

    const result = await handler({}, { name: "xqc" });

    expect(serviceMock.fetchFFZRoom).toHaveBeenCalledWith({ name: "xqc" });
    expect(result).toEqual(room);
  });
});
