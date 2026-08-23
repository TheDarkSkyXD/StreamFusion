import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

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
    send: electronMocks.send,
    sendSync: electronMocks.sendSync,
  },
}));

beforeAll(async () => {
  await import("@/preload/index");
});

beforeEach(() => {
  electronMocks.invoke.mockReset();
  electronMocks.on.mockReset();
  electronMocks.removeListener.mockReset();
});

// Guards: the renderer can control local captions only through the typed model and session IPC boundary.
describe("preload local caption boundary", () => {
  it("routes model lifecycle and bounded session calls through their named channels", async () => {
    electronMocks.invoke.mockResolvedValue(undefined);
    const audio = {
      sessionId: "kick:talker",
      generation: 3,
      sequence: 1,
      mediaTime: 42,
      sampleRate: 16_000 as const,
      samples: new Float32Array(3_200).buffer,
    };

    await electronMocks.exposedApi.localCaptions.getModelState();
    await electronMocks.exposedApi.localCaptions.downloadModel();
    await electronMocks.exposedApi.localCaptions.cancelModelDownload();
    await electronMocks.exposedApi.localCaptions.removeModel();
    await electronMocks.exposedApi.localCaptions.start("kick:talker", 3);
    await electronMocks.exposedApi.localCaptions.pushAudio(audio);
    await electronMocks.exposedApi.localCaptions.stop("kick:talker", 3);

    expect(electronMocks.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_GET_STATE],
      [IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_DOWNLOAD],
      [IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_CANCEL],
      [IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_REMOVE],
      [IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START, { sessionId: "kick:talker", generation: 3 }],
      [IPC_CHANNELS.LOCAL_CAPTIONS_AUDIO_PUSH, audio],
      [IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_STOP, { sessionId: "kick:talker", generation: 3 }],
    ]);
  });

  it("forwards model, recognizer, and result pushes and removes the exact listeners", () => {
    const subscriptions = [
      ["onModelState", IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_STATE],
      ["onRecognizerState", IPC_CHANNELS.LOCAL_CAPTIONS_RECOGNIZER_STATE],
      ["onResult", IPC_CHANNELS.LOCAL_CAPTIONS_RESULT],
    ] as const;

    for (const [method, channel] of subscriptions) {
      const callback = vi.fn();
      const unsubscribe = electronMocks.exposedApi.localCaptions[method](callback);
      const listener = electronMocks.on.mock.calls.at(-1)?.[1];
      const payload = { channel };

      expect(electronMocks.on).toHaveBeenLastCalledWith(channel, listener);
      listener({}, payload);
      expect(callback).toHaveBeenCalledWith(payload);

      unsubscribe();
      expect(electronMocks.removeListener).toHaveBeenLastCalledWith(channel, listener);
    }
  });
});
