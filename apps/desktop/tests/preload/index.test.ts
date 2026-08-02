import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  exposedApi: undefined as any,
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    if (name === "electronAPI") electronMocks.exposedApi = api;
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(() => []),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
    sendSync: electronMocks.sendSync,
  },
}));

beforeAll(async () => {
  await import("@/preload/index");
});

beforeEach(() => {
  electronMocks.invoke.mockReset();
});

// Guards: preload exposes no renderer-controlled Twitch DCF polling state and keeps raw token storage Kick-only.
describe("preload auth boundary", () => {
  it("exposes only the main-owned Twitch login flow and the narrow IRC/Hermes token capability", () => {
    expect(electronMocks.exposedApi.auth).not.toHaveProperty("startDeviceCodeFlow");
    expect(electronMocks.exposedApi.auth).not.toHaveProperty("pollDeviceCode");
    expect(electronMocks.exposedApi.auth).not.toHaveProperty("cancelDeviceCodeFlow");
    expect(electronMocks.exposedApi.auth.openTwitchLogin).toBeTypeOf("function");
    expect(electronMocks.exposedApi.auth.getValidTwitchToken).toBeTypeOf("function");
  });

  it("forwards Twitch refresh metadata without transforming it into a token response", async () => {
    const metadata = {
      success: true,
      user: null,
      hasToken: true,
      isExpired: false,
    };
    electronMocks.invoke.mockResolvedValueOnce(metadata);

    await expect(electronMocks.exposedApi.auth.refreshTwitchToken()).resolves.toBe(metadata);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.AUTH_REFRESH_TWITCH);
  });
});

describe("preload third-party badge catalogs", () => {
  // Guards: the renderer can request BTTV badges only through the named, one-shot IPC bridge.
  it("forwards BTTV badge catalog requests", async () => {
    const catalog = [
      {
        providerId: "user123",
        badge: { description: "BTTV Developer", svg: "https://cdn.example/badge.svg" },
      },
    ];
    electronMocks.invoke.mockResolvedValueOnce(catalog);

    const result = await electronMocks.exposedApi.emotes.bttv.getBadges();

    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.EMOTES_BTTV_GET_BADGES);
    expect(result).toEqual(catalog);
  });

  it("forwards FFZ badge catalog requests", async () => {
    const catalog = {
      badges: [{ id: 1, title: "FFZ Developer", color: "#ff0000", urls: { "1": "one" } }],
      users: { "1": ["11111"] },
    };
    electronMocks.invoke.mockResolvedValueOnce(catalog);

    const result = await electronMocks.exposedApi.emotes.ffz.getBadges();

    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.EMOTES_FFZ_GET_BADGES);
    expect(result).toEqual(catalog);
  });
});

// Guards: renderer reachability checks can only invoke the narrow main-process connectivity probe.
describe("preload connectivity boundary", () => {
  it("forwards an end-to-end reachability check through its named IPC channel", async () => {
    const result = { reachable: true };
    electronMocks.invoke.mockResolvedValueOnce(result);

    await expect(electronMocks.exposedApi.connectivity.check()).resolves.toBe(result);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.CONNECTIVITY_CHECK);
  });
});
