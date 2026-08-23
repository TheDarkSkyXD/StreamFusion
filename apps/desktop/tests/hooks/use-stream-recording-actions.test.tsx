import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useStreamRecordingActions } from "@/hooks/use-stream-recording-actions";
import { installElectronAPIMock } from "../test-utils";

// Guards: recording starts use the dedicated preload bridge and surface success to the user
// Guards: an already-active recording is returned to the watch page without a generic error toast
// Guards: restart recovery actions remain recording-scoped and dismissal carries explicit confirmation
describe("useStreamRecordingActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts through the dedicated Stream Recording bridge", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.start = vi.fn<typeof api.streamRecording.start>(async () => ({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    }));
    const { result } = renderHook(() => useStreamRecordingActions());
    const request = {
      platform: "twitch" as const,
      channelName: "ninja",
      streamId: "stream-live-123",
      title: "Stream",
    };

    await act(async () => {
      await expect(result.current.start(request)).resolves.toEqual({
        success: true,
        outcome: "started",
        sessionId: "recording-session-1",
      });
    });

    expect(api.streamRecording.start).toHaveBeenCalledWith(request);
  });

  it("returns the blocked active Stream result for the watch page to render", async () => {
    const api = installElectronAPIMock();
    const blocked = {
      success: false,
      outcome: "blocked",
      code: "stream-recording-active",
      error: "A Stream Recording is already active",
      activeRecording: {
        sessionId: "recording-session-1",
        platform: "kick",
        channelName: "xqc",
        title: "Active Stream",
        status: "recording",
      },
    } as const;
    api.streamRecording.start = vi.fn<typeof api.streamRecording.start>(async () => blocked);
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(
        result.current.start({
          platform: "twitch",
          channelName: "ninja",
          streamId: "stream-live-456",
          title: "Second",
        })
      ).resolves.toEqual(blocked);
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("pauses and resumes only through the dedicated recording bridge", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.pause = vi.fn(async () => ({ success: true }));
    api.streamRecording.resume = vi.fn(async () => ({ success: true }));
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.pause("recording-session-1")).resolves.toEqual({ success: true });
      await expect(result.current.resume("recording-session-1")).resolves.toEqual({
        success: true,
      });
    });

    expect(api.streamRecording.pause).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.resume).toHaveBeenCalledWith("recording-session-1");
    expect(api.downloads.pause).not.toHaveBeenCalled();
    expect(api.downloads.resume).not.toHaveBeenCalled();
  });

  it("returns a visible failure instead of leaving Resume stuck when IPC rejects", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.resume = vi.fn(async () => {
      throw new Error("main process unavailable");
    });
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.resume("recording-session-1")).resolves.toEqual({
        success: false,
        error: "main process unavailable",
      });
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("stops and opens the transient result only through recording-scoped commands", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.stop = vi.fn(async () => ({ success: true }));
    api.streamRecording.openCompleted = vi.fn(async () => ({ success: true }));
    api.streamRecording.showCompleted = vi.fn(async () => ({ success: true }));
    api.streamRecording.dismissNotice = vi.fn(async () => ({ success: true }));
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.stop("recording-session-1")).resolves.toEqual({ success: true });
      await expect(result.current.openCompleted("recording-session-1")).resolves.toEqual({
        success: true,
      });
      await expect(result.current.showCompleted("recording-session-1")).resolves.toEqual({
        success: true,
      });
      await expect(result.current.dismissNotice("recording-session-1")).resolves.toEqual({
        success: true,
      });
    });

    expect(api.streamRecording.stop).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.openCompleted).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.showCompleted).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.dismissNotice).toHaveBeenCalledWith("recording-session-1");
    expect(api.downloads.openFile).not.toHaveBeenCalled();
    expect(api.downloads.showInFolder).not.toHaveBeenCalled();
  });

  it("discards only through the recording bridge", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.discard = vi.fn(async () => ({ success: true }));
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.discard("recording-session-1")).resolves.toEqual({
        success: true,
      });
    });

    expect(api.streamRecording.discard).toHaveBeenCalledWith("recording-session-1");
    expect(api.downloads.deleteFile).not.toHaveBeenCalled();
  });

  it("resumes, finalizes, and explicitly dismisses an interrupted session through recovery IPC", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.resumeInterrupted = vi.fn<typeof api.streamRecording.resumeInterrupted>(
      async () => ({ success: true })
    );
    api.streamRecording.finalizeInterrupted = vi.fn<typeof api.streamRecording.finalizeInterrupted>(
      async () => ({ success: true })
    );
    api.streamRecording.dismissInterrupted = vi.fn<typeof api.streamRecording.dismissInterrupted>(
      async () => ({ success: true })
    );
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.resumeInterrupted("recording-session-1")).resolves.toEqual({
        success: true,
      });
      await expect(result.current.finalizeInterrupted("recording-session-1")).resolves.toEqual({
        success: true,
      });
      await expect(result.current.dismissInterrupted("recording-session-1")).resolves.toEqual({
        success: true,
      });
    });

    expect(api.streamRecording.resumeInterrupted).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.finalizeInterrupted).toHaveBeenCalledWith("recording-session-1");
    expect(api.streamRecording.dismissInterrupted).toHaveBeenCalledWith(
      "recording-session-1",
      true
    );
    expect(api.downloads.resume).not.toHaveBeenCalled();
  });

  it("converts rejected recovery IPC promises into typed bridge failures", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.resumeInterrupted = vi.fn<typeof api.streamRecording.resumeInterrupted>(
      async () => {
        throw new Error("renderer disconnected");
      }
    );
    api.streamRecording.finalizeInterrupted = vi.fn<typeof api.streamRecording.finalizeInterrupted>(
      async () => {
        throw new Error("main process unavailable");
      }
    );
    api.streamRecording.dismissInterrupted = vi.fn<typeof api.streamRecording.dismissInterrupted>(
      async () => {
        throw new Error("journal bridge closed");
      }
    );
    const { result } = renderHook(() => useStreamRecordingActions());

    await act(async () => {
      await expect(result.current.resumeInterrupted("recording-session-1")).resolves.toEqual({
        success: false,
        code: "bridge-error",
        error: "renderer disconnected",
      });
      await expect(result.current.finalizeInterrupted("recording-session-1")).resolves.toEqual({
        success: false,
        code: "bridge-error",
        error: "main process unavailable",
      });
      await expect(result.current.dismissInterrupted("recording-session-1")).resolves.toEqual({
        success: false,
        code: "bridge-error",
        error: "journal bridge closed",
      });
    });
    expect(toast.error).toHaveBeenCalledTimes(3);
  });
});
