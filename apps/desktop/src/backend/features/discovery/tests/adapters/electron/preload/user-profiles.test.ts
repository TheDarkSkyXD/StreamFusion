import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  exposedApi: {} as Window["electronAPI"],
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    if (name === "electronAPI") electronMocks.exposedApi = api as Window["electronAPI"];
  }),
  invoke: vi.fn(),
}));

vi.mock("@backend/preload/ipc-feature-loader", () => ({
  createFeatureAwareIpc: (invoke: unknown, send: unknown) => ({
    invoke,
    send,
    loadFeature: vi.fn(async () => undefined),
  }),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn(() => []),
  },
}));

beforeAll(async () => {
  await import("@backend/preload/index");
});

beforeEach(() => electronMocks.invoke.mockReset());

// Guards: every named user-profile method forwards its exact request to its paired IPC channel.
describe("preload user-profile boundary", () => {
  it("preserves all Twitch and Kick method-to-channel mappings", async () => {
    const twitchIdentity = { userId: "t1", username: "alice" };
    const twitchFollow = { broadcasterId: "b1", userId: "t1", username: "alice" };
    const twitchChannel = { username: "alice" };
    const kickIdentity = { userId: "k1", username: "bob", channelSlug: "bob-live" };
    const kickChannel = { username: "bob" };
    const calls = [
      {
        channel: IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY,
        request: twitchIdentity,
        invoke: () => electronMocks.exposedApi.userProfiles.getTwitchIdentity(twitchIdentity),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED,
        request: twitchIdentity,
        invoke: () => electronMocks.exposedApi.userProfiles.getTwitchAccountCreated(twitchIdentity),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW,
        request: twitchFollow,
        invoke: () => electronMocks.exposedApi.userProfiles.getTwitchFollow(twitchFollow),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL,
        request: twitchChannel,
        invoke: () => electronMocks.exposedApi.userProfiles.resolveTwitchChannel(twitchChannel),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY,
        request: kickIdentity,
        invoke: () => electronMocks.exposedApi.userProfiles.getKickIdentity(kickIdentity),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED,
        request: kickIdentity,
        invoke: () => electronMocks.exposedApi.userProfiles.getKickAccountCreated(kickIdentity),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW,
        request: kickIdentity,
        invoke: () => electronMocks.exposedApi.userProfiles.getKickFollow(kickIdentity),
      },
      {
        channel: IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL,
        request: kickChannel,
        invoke: () => electronMocks.exposedApi.userProfiles.resolveKickChannel(kickChannel),
      },
    ];

    for (const [index, call] of calls.entries()) {
      const response = { state: "failed", message: `Unavailable ${index}` } as const;
      electronMocks.invoke.mockResolvedValueOnce(response);

      await expect(call.invoke()).resolves.toBe(response);
      expect(electronMocks.invoke).toHaveBeenNthCalledWith(index + 1, call.channel, call.request);
    }
  });
});
