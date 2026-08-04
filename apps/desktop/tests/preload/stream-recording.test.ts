import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectronAPI } from "@/preload/index";
import { IPC_CHANNELS } from "@/shared/ipc-channels";
import type {
  StreamRecordingRequest,
  StreamRecordingSnapshot,
} from "@/shared/stream-recording-types";

type StreamRecordingStateListener = (event: unknown, snapshot: StreamRecordingSnapshot) => void;

const electronMocks = vi.hoisted(() => {
  let exposedApi: ElectronAPI | undefined;

  return {
    get exposedApi(): ElectronAPI | undefined {
      return exposedApi;
    },
    exposeInMainWorld: vi.fn((name: string, api: ElectronAPI) => {
      if (name === "electronAPI") exposedApi = api;
    }),
    invoke: vi.fn(),
    on: vi.fn<(channel: string, listener: StreamRecordingStateListener) => void>(),
    removeListener: vi.fn<(channel: string, listener: StreamRecordingStateListener) => void>(),
    send: vi.fn(),
    sendSync: vi.fn(() => []),
  };
});

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

function api(): ElectronAPI {
  if (!electronMocks.exposedApi) throw new Error("Preload did not expose electronAPI");
  return electronMocks.exposedApi;
}

beforeAll(async () => {
  await import("@/preload/index");
});

beforeEach(() => {
  electronMocks.invoke.mockReset();
  electronMocks.on.mockReset();
  electronMocks.removeListener.mockReset();
});

// Guards: recording commands cross preload on dedicated channels with only their authoritative payloads
// Guards: recording state subscriptions forward snapshots unchanged and remove their exact listener
describe("preload Stream Recording bridge", () => {
  it("routes recording commands through their exact IPC contracts", async () => {
    const request: StreamRecordingRequest = {
      platform: "twitch",
      channelName: "ninja",
      streamId: "stream-live-123",
      title: "Live Stream",
    };
    const sessionId = "recording-session-1";

    await api().streamRecording.getState();
    await api().streamRecording.start(request);
    await api().streamRecording.stop(sessionId);
    await api().streamRecording.discard(sessionId);
    await api().streamRecording.pause(sessionId);
    await api().streamRecording.resume(sessionId);
    await api().streamRecording.resumeInterrupted(sessionId);
    await api().streamRecording.finalizeInterrupted(sessionId);
    await api().streamRecording.dismissInterrupted(sessionId, true);
    await api().streamRecording.openCompleted(sessionId);
    await api().streamRecording.showCompleted(sessionId);
    await api().streamRecording.dismissNotice(sessionId);

    expect(electronMocks.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.STREAM_RECORDING_GET_STATE],
      [IPC_CHANNELS.STREAM_RECORDING_START, request],
      [IPC_CHANNELS.STREAM_RECORDING_STOP, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_DISCARD, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_PAUSE, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_RESUME, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED, { sessionId, confirmed: true }],
      [IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED, { sessionId }],
      [IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE, { sessionId }],
    ]);
  });

  it("forwards recording state and removes the exact listener during cleanup", () => {
    const callback = vi.fn<(snapshot: StreamRecordingSnapshot) => void>();
    const snapshot: StreamRecordingSnapshot = {
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Live Stream",
        status: "recording",
        qualityLabel: "Source",
      },
      notice: null,
    };

    const cleanup = api().streamRecording.onStateChanged(callback);
    const listener = electronMocks.on.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED
    )?.[1];
    if (!listener) throw new Error("Recording state listener was not registered");

    listener({}, snapshot);
    expect(callback).toHaveBeenCalledWith(snapshot);

    cleanup();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED,
      listener
    );
  });
});
