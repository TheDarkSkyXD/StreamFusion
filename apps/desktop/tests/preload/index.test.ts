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

describe("preload follow account transitions", () => {
  // Guards: long-lived account writes reach the renderer through a removable, typed push listener.
  // Guards: restart hydration reads pending account writes only through the named IPC bridge.
  it("forwards a Twitch account write unchanged through the named channel", async () => {
    const request = {
      action: "follow",
      follow: {
        platform: "twitch",
        channelId: "12345",
        channelName: "example_channel",
        displayName: "Example Channel",
      },
    };
    const result = { status: "confirmed", activeFollows: [] };
    electronMocks.invoke.mockResolvedValueOnce(result);

    await expect(electronMocks.exposedApi.follows.writeAccount(request)).resolves.toBe(result);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT,
      request
    );
  });

  it("requests sanitized persisted account writes through the named channel", async () => {
    const snapshots = [{ status: "pending", action: "unfollow" }];
    electronMocks.invoke.mockResolvedValueOnce(snapshots);

    await expect(electronMocks.exposedApi.follows.getAccountWrites()).resolves.toBe(snapshots);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.FOLLOWS_GET_ACCOUNT_WRITES);
  });

  it("forwards account-write changes unchanged and removes the exact listener", () => {
    const callback = vi.fn();
    const event = {
      status: "confirmed",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "summit1g",
      },
      activeFollows: [],
    };

    const cleanup = electronMocks.exposedApi.follows.onAccountWriteChanged(callback);
    const registration = electronMocks.on.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED
    );
    expect(registration).toBeDefined();
    const handler = registration?.[1];

    handler({}, event);

    expect(callback).toHaveBeenCalledWith(event);
    cleanup();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED,
      handler
    );
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

// Guards: Chat Replay load and cancellation stay reachable through typed, named video IPC methods.
describe("preload Chat Replay boundary", () => {
  it("forwards replay window requests and cancellation without changing their payloads", async () => {
    const request = {
      platform: "twitch",
      videoId: "video-1",
      offsetSeconds: 120,
      requestId: "replay-request-1",
    };
    const response = {
      success: true,
      data: { capability: "empty", platform: "twitch", videoId: "video-1" },
    };
    electronMocks.invoke.mockResolvedValueOnce(response).mockResolvedValueOnce({ cancelled: true });

    await expect(electronMocks.exposedApi.videos.getChatReplayWindow(request)).resolves.toBe(
      response
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW,
      request
    );

    const cancelRequest = { requestId: request.requestId };
    await expect(
      electronMocks.exposedApi.videos.cancelChatReplayWindow(cancelRequest)
    ).resolves.toEqual({ cancelled: true });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.VIDEOS_CANCEL_CHAT_REPLAY_WINDOW,
      cancelRequest
    );
  });
});
