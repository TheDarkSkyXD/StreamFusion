import { beforeAll, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  exposedApi: {} as Window["electronAPI"],
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    if (name === "electronAPI") electronMocks.exposedApi = api as Window["electronAPI"];
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("@/preload/ipc-feature-loader", () => ({
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
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: vi.fn(),
    sendSync: vi.fn(() => []),
  },
}));

beforeAll(async () => {
  await import("@/preload/index");
});

// Guards: preload forwards only the typed Twitch command and never adds renderer credentials.
describe("preload Twitch API bridge", () => {
  it("forwards an allowlisted command unchanged", async () => {
    const command = { operation: "resolve-channel" as const, login: "streamer" };

    await electronMocks.exposedApi.twitch.execute(command);

    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.TWITCH_API_EXECUTE, command);
    expect(JSON.stringify(electronMocks.invoke.mock.lastCall)).not.toMatch(/token|client.?id/i);
  });

  it("exposes a cleanup-safe main-owned EventSub feed bridge", async () => {
    const callback = vi.fn();
    const cleanup = electronMocks.exposedApi.twitch.eventSub.onEvent(callback);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.TWITCH_EVENTSUB_EVENT
    )?.[1];

    await electronMocks.exposedApi.twitch.eventSub.start({
      feedId: "feed-1",
      userId: "200",
      channelId: "100",
    });
    handler({}, { feedId: "feed-1", payload: { event: { action: "delete" } } });
    cleanup();

    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.TWITCH_EVENTSUB_START, {
      feedId: "feed-1",
      userId: "200",
      channelId: "100",
    });
    expect(callback).toHaveBeenCalledWith({
      feedId: "feed-1",
      payload: { event: { action: "delete" } },
    });
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.TWITCH_EVENTSUB_EVENT,
      handler
    );
  });
});
