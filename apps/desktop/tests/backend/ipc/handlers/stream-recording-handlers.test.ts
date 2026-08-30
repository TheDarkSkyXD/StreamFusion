import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("@backend/services/stream-recording-default-service", () => ({
  getDefaultStreamRecordingService: vi.fn(),
}));
vi.mock("@backend/services/stream-recording-session-store", () => ({
  getStreamRecordingSessionStore: vi.fn(),
}));

import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { registerStreamRecordingHandlers as registerWithRenderer } from "@backend/ipc/handlers/stream-recording-handlers";
import { getDefaultStreamRecordingService } from "@backend/services/stream-recording-default-service";
import type { StreamRecordingService } from "@backend/services/stream-recording-service";
import type { StreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import { getStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type { StreamRecordingSnapshot } from "@shared/stream-recording-types";
import { createMainRendererPortMock } from "../../../helpers/main-renderer-port-mock";

type Handler = (event: unknown, payload?: unknown) => unknown;

const fileSender = { senderFrame: { url: "file:///app/renderer/index.html" } };
const localhostSender = { senderFrame: { url: "http://localhost:5173/" } };
const remoteSender = { senderFrame: { url: "https://www.twitch.tv/embed" } };

function handler(channel: string): Handler {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel);
  if (!found) throw new Error(`Missing handler: ${channel}`);
  return found[1] as Handler;
}

function createService(overrides: Partial<StreamRecordingService> = {}): StreamRecordingService {
  return {
    getSnapshot: vi.fn(() => ({ active: null, notice: null })),
    startRecording: vi.fn(async () => ({
      success: true as const,
      outcome: "started" as const,
      sessionId: "recording-session-1",
    })),
    stopRecording: vi.fn(async () => ({ success: true })),
    discardRecording: vi.fn(async () => ({ success: true })),
    pauseRecording: vi.fn(async () => ({ success: true })),
    resumeRecording: vi.fn(async () => ({ success: true })),
    resumeInterrupted: vi.fn(async () => ({ success: true as const })),
    finalizeInterrupted: vi.fn(async () => ({ success: true as const })),
    dismissInterrupted: vi.fn(async () => ({ success: true as const })),
    openCompletedRecording: vi.fn(async () => ({ success: true })),
    showCompletedRecording: vi.fn(async () => ({ success: true })),
    dismissNotice: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function createSessionStore(
  overrides: Partial<StreamRecordingSessionStore> = {}
): StreamRecordingSessionStore {
  return {
    getJournal: vi.fn(() => ({ version: 2 as const, state: "empty" as const, session: null })),
    getSnapshot: vi.fn(() => ({ active: null, notice: null })),
    saveSession: vi.fn(),
    clearSession: vi.fn(),
    setNotice: vi.fn(),
    settle: vi.fn(() => true),
    dismissNotice: vi.fn(() => true),
    subscribe: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function createMainWindow(send = vi.fn()): BrowserWindow {
  return Object.assign(Object.create(null), {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send },
  });
}

function registerStreamRecordingHandlers(window: BrowserWindow): void {
  registerWithRenderer(createMainRendererPortMock(window));
}

// Guards: malformed recording requests stop at the IPC boundary before reaching the service
// Guards: every recording request rejects remote or unidentified renderer frames before touching the service
// Guards: production file and development localhost renderer frames remain allowed
// Guards: recording state changes, including reconnect quality revisions, are pushed on the dedicated renderer channel
// Guards: reconnect and durable exhaustion phases cross IPC without entering Downloads IPC
// Guards: interrupted-session dismissal is routed through the recording service
// Guards: every recovery bridge failure preserves the public discriminant required by preload callers
// Guards: transient outcome dismissal is recording-scoped and sender-guarded
// Guards: start IPC rejects requests that omit the current provider's stable live Stream identity
describe("Stream Recording IPC handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes start and state through the recording service", async () => {
    const snapshot = { active: null, notice: null };
    const service = createService({
      getSnapshot: vi.fn(() => snapshot),
      startRecording: vi.fn(async () => ({
        success: true as const,
        outcome: "started" as const,
        sessionId: "recording-session-1",
      })),
    });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());
    const request = {
      platform: "twitch",
      channelName: "ninja",
      streamId: "stream-live-123",
      title: "Stream",
    };

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_START)(fileSender, request)
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
    expect(service.startRecording).toHaveBeenCalledWith(request);
    expect(handler(IPC_CHANNELS.STREAM_RECORDING_GET_STATE)(fileSender)).toBe(snapshot);
  });

  it("returns an empty snapshot to a remote sender without reading recording state", () => {
    const service = createService({ getSnapshot: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(handler(IPC_CHANNELS.STREAM_RECORDING_GET_STATE)(remoteSender)).toEqual({
      active: null,
      notice: null,
    });
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a remote Start sender before it reaches the recording service", async () => {
    const service = createService({ startRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_START)(remoteSender, {
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
      })
    ).toEqual({
      success: false,
      outcome: "failed",
      error: "Rejected: caller is not the application renderer.",
    });
    expect(service.startRecording).not.toHaveBeenCalled();
  });

  it("rejects malformed start requests before they reach the service", async () => {
    const service = createService({ startRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_START)(localhostSender, {
        platform: "youtube",
        channelName: "",
        title: 42,
      })
    ).toEqual({ success: false, outcome: "failed", error: "Invalid Stream Recording request" });
    expect(service.startRecording).not.toHaveBeenCalled();
  });

  it("rejects a start request without a stable live Stream identity", () => {
    const service = createService({ startRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_START)(localhostSender, {
        platform: "kick",
        channelName: "nerdballertv",
        title: "NerdBallerTV Live",
      })
    ).toEqual({ success: false, outcome: "failed", error: "Invalid Stream Recording request" });
    expect(service.startRecording).not.toHaveBeenCalled();
  });

  it("pushes dedicated state-changed snapshots to the renderer", () => {
    let listener: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    const send = vi.fn();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(createService());
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(
      createSessionStore({
        subscribe: vi.fn((next) => {
          listener = next;
          return vi.fn();
        }),
      })
    );
    registerStreamRecordingHandlers(createMainWindow(send));
    const snapshot: StreamRecordingSnapshot = {
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Live",
        status: "recording",
        qualityLabel: "720p60",
        desiredQualityLabel: "Source",
        currentQualityLabel: "720p60",
        qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
      },
      notice: null,
    };

    listener?.(snapshot);

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED, snapshot);
  });

  it("pushes reconnect and durable exhaustion snapshots on only the recording channel", () => {
    let listener: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    const send = vi.fn();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(createService());
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(
      createSessionStore({
        subscribe: vi.fn((next) => {
          listener = next;
          return vi.fn();
        }),
      })
    );
    registerStreamRecordingHandlers(createMainWindow(send));
    const base = {
      sessionId: "recording-session-1",
      platform: "twitch" as const,
      channelName: "ninja",
      title: "Live",
      capturedDurationSeconds: 12,
    };

    listener?.({
      active: { ...base, status: "reconnecting", recoveryExhaustionState: null },
      notice: null,
    });
    listener?.({
      active: { ...base, status: "finalizing", recoveryExhaustionState: "finalizing" },
      notice: null,
    });

    expect(send).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED,
      expect.objectContaining({ active: expect.objectContaining({ status: "reconnecting" }) })
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED,
      expect.objectContaining({
        active: expect.objectContaining({
          status: "finalizing",
          recoveryExhaustionState: "finalizing",
        }),
      })
    );
    expect(
      send.mock.calls.every(([channel]) => channel === IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED)
    ).toBe(true);
  });

  it("routes interrupted-session dismissal through the recording service", async () => {
    const service = createService({
      dismissInterrupted: vi.fn(async () => ({ success: true as const })),
    });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED)(fileSender, {
        sessionId: "recording-session-1",
        confirmed: true,
      })
    ).resolves.toEqual({ success: true });
    expect(service.dismissInterrupted).toHaveBeenCalledWith("recording-session-1", true);
  });

  it("routes guarded restart Resume and Finalize Partial actions by session identity", async () => {
    const service = createService();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());
    const payload = { sessionId: "recording-session-1" };

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED)(fileSender, payload)
    ).resolves.toEqual({ success: true });
    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED)(fileSender, payload)
    ).resolves.toEqual({ success: true });

    expect(service.resumeInterrupted).toHaveBeenCalledWith("recording-session-1");
    expect(service.finalizeInterrupted).toHaveBeenCalledWith("recording-session-1");
  });

  it("rejects restart recovery mutations from a remote sender", () => {
    const service = createService({
      resumeInterrupted: vi.fn(),
      finalizeInterrupted: vi.fn(),
    });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());
    const payload = { sessionId: "recording-session-1" };

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED)(remoteSender, payload)
    ).toEqual({
      success: false,
      code: "bridge-error",
      error: "Rejected: caller is not the application renderer.",
    });
    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED)(remoteSender, payload)
    ).toEqual({
      success: false,
      code: "bridge-error",
      error: "Rejected: caller is not the application renderer.",
    });
    expect(service.resumeInterrupted).not.toHaveBeenCalled();
    expect(service.finalizeInterrupted).not.toHaveBeenCalled();
  });

  it.each([
    IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED,
    IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED,
    IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED,
  ])("returns typed bridge errors for rejected or missing-session %s calls", (channel) => {
    const service = createService({
      resumeInterrupted: vi.fn(),
      finalizeInterrupted: vi.fn(),
      dismissInterrupted: vi.fn(),
    });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(handler(channel)(remoteSender, { sessionId: "recording-session-1" })).toEqual({
      success: false,
      code: "bridge-error",
      error: "Rejected: caller is not the application renderer.",
    });
    expect(handler(channel)(fileSender, {})).toEqual({
      success: false,
      code: "bridge-error",
      error: "sessionId is required",
    });
    expect(service.resumeInterrupted).not.toHaveBeenCalled();
    expect(service.finalizeInterrupted).not.toHaveBeenCalled();
    expect(service.dismissInterrupted).not.toHaveBeenCalled();
  });

  it("routes transient outcome dismissal by session identity", async () => {
    const service = createService();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE)(fileSender, {
        sessionId: "recording-session-1",
        path: "C:/arbitrary/file.exe",
      })
    ).resolves.toEqual({ success: true });
    expect(service.dismissNotice).toHaveBeenCalledWith("recording-session-1");
  });

  it("rejects transient outcome dismissal from a remote sender", () => {
    const service = createService({ dismissNotice: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE)(remoteSender, {
        sessionId: "recording-session-1",
      })
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.dismissNotice).not.toHaveBeenCalled();
  });

  it("rejects interrupted-session dismissal from a remote sender", () => {
    const service = createService({ dismissInterrupted: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED)(remoteSender, {
        sessionId: "recording-session-1",
      })
    ).toEqual({
      success: false,
      code: "bridge-error",
      error: "Rejected: caller is not the application renderer.",
    });
    expect(service.dismissInterrupted).not.toHaveBeenCalled();
  });

  it("routes Pause and Resume through only the recording controller", async () => {
    const service = createService();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());
    const payload = { sessionId: "recording-session-1" };

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_PAUSE)(localhostSender, payload)
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_RESUME)(localhostSender, payload)
    ).resolves.toEqual({
      success: true,
    });

    expect(service.pauseRecording).toHaveBeenCalledWith("recording-session-1");
    expect(service.resumeRecording).toHaveBeenCalledWith("recording-session-1");
  });

  it("rejects Pause from a remote sender", () => {
    const service = createService({ pauseRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_PAUSE)(remoteSender, {
        sessionId: "recording-session-1",
      })
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.pauseRecording).not.toHaveBeenCalled();
  });

  it("rejects Resume when sender-frame identity is missing", () => {
    const service = createService({ resumeRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_RESUME)(
        {},
        {
          sessionId: "recording-session-1",
        }
      )
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.resumeRecording).not.toHaveBeenCalled();
  });

  it("routes Stop and completed-file actions by session identity without accepting a path", async () => {
    const service = createService();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());
    const payload = { sessionId: "recording-session-1", path: "C:/arbitrary/file.exe" };

    await expect(handler(IPC_CHANNELS.STREAM_RECORDING_STOP)(fileSender, payload)).resolves.toEqual(
      {
        success: true,
      }
    );
    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED)(fileSender, payload)
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED)(fileSender, payload)
    ).resolves.toEqual({
      success: true,
    });

    expect(service.stopRecording).toHaveBeenCalledWith("recording-session-1");
    expect(service.openCompletedRecording).toHaveBeenCalledWith("recording-session-1");
    expect(service.showCompletedRecording).toHaveBeenCalledWith("recording-session-1");
    expect(JSON.stringify(vi.mocked(ipcMain.handle).mock.calls)).not.toContain(
      "arbitrary/file.exe"
    );
  });

  it("rejects Stop when sender-frame identity is missing", () => {
    const service = createService({ stopRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_STOP)({}, { sessionId: "recording-session-1" })
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.stopRecording).not.toHaveBeenCalled();
  });

  it("routes Discard by session identity and rejects remote callers", async () => {
    const service = createService();
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    await expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISCARD)(fileSender, {
        sessionId: "recording-session-1",
        path: "C:/arbitrary/file.exe",
      })
    ).resolves.toEqual({ success: true });
    expect(service.discardRecording).toHaveBeenCalledWith("recording-session-1");

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_DISCARD)(remoteSender, {
        sessionId: "recording-session-1",
      })
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.discardRecording).toHaveBeenCalledTimes(1);
  });

  it("rejects Open completed recording when sender-frame identity is missing", () => {
    const service = createService({ openCompletedRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED)(
        {},
        {
          sessionId: "recording-session-1",
        }
      )
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.openCompletedRecording).not.toHaveBeenCalled();
  });

  it("rejects Show completed recording from a remote sender", () => {
    const service = createService({ showCompletedRecording: vi.fn() });
    vi.mocked(getDefaultStreamRecordingService).mockReturnValue(service);
    vi.mocked(getStreamRecordingSessionStore).mockReturnValue(createSessionStore());
    registerStreamRecordingHandlers(createMainWindow());

    expect(
      handler(IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED)(remoteSender, {
        sessionId: "recording-session-1",
      })
    ).toEqual({ success: false, error: "Rejected: caller is not the application renderer." });
    expect(service.showCompletedRecording).not.toHaveBeenCalled();
  });
});
