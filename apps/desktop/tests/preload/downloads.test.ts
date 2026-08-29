import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  exposedApi: {} as Window["electronAPI"],
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    if (name === "electronAPI") electronMocks.exposedApi = api as Window["electronAPI"];
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(() => []),
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
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
    sendSync: electronMocks.sendSync,
  },
}));

beforeAll(async () => {
  await import("@backend/preload/index");
});

beforeEach(() => {
  electronMocks.invoke.mockClear();
  electronMocks.on.mockClear();
  electronMocks.removeListener.mockClear();
});

// Guards: the renderer bridge exposes dedicated download workflows, never arbitrary queue insertion
// Guards: every Downloads bridge method forwards its exact request shape over its dedicated IPC channel
// Guards: queue subscriptions forward snapshots and remove their exact listener during cleanup
describe("preload Downloads bridge", () => {
  it("forwards download and queue operations over their exact channels", async () => {
    const clipRequest = {
      platform: "twitch" as const,
      clipId: "clip-1",
      title: "Clip",
      channelName: "streamer",
      clipUrl: "https://video.example/clip.m3u8",
    };
    const videoRequest = {
      platform: "kick" as const,
      videoId: "video-1",
      title: "VOD",
      channelName: "streamer",
      playbackUrl: "https://video.example/vod.m3u8",
    };
    await electronMocks.exposedApi.downloads.getQueue();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.DOWNLOADS_GET_QUEUE);

    await electronMocks.exposedApi.downloads.downloadClip(clipRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP,
      clipRequest
    );

    await electronMocks.exposedApi.downloads.downloadVideo(videoRequest);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO,
      videoRequest
    );

    expect("enqueue" in electronMocks.exposedApi.downloads).toBe(false);

    const operations = [
      ["pause", IPC_CHANNELS.DOWNLOADS_PAUSE],
      ["resume", IPC_CHANNELS.DOWNLOADS_RESUME],
      ["cancel", IPC_CHANNELS.DOWNLOADS_CANCEL],
      ["retry", IPC_CHANNELS.DOWNLOADS_RETRY],
      ["remove", IPC_CHANNELS.DOWNLOADS_REMOVE],
      ["showInFolder", IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER],
      ["openFile", IPC_CHANNELS.DOWNLOADS_OPEN_FILE],
      ["deleteFile", IPC_CHANNELS.DOWNLOADS_DELETE_FILE],
    ] as const;

    for (const [method, channel] of operations) {
      await electronMocks.exposedApi.downloads[method]("job-1");
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(channel, { id: "job-1" });
    }
  });

  it("forwards queue snapshots and removes the exact listener on cleanup", () => {
    const callback = vi.fn();
    const snapshot = { jobs: [{ id: "job-1", status: "downloading" }] };

    const cleanup = electronMocks.exposedApi.downloads.onQueueChanged(callback);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.DOWNLOADS_QUEUE_CHANGED
    )?.[1];

    expect(handler).toBeTypeOf("function");
    handler({}, snapshot);
    expect(callback).toHaveBeenCalledWith(snapshot);

    cleanup();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.DOWNLOADS_QUEUE_CHANGED,
      handler
    );
  });
});
