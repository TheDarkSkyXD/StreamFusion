import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  StreamRecordingProvider,
  useStreamRecordingState,
} from "@/hooks/use-stream-recording-state";
import type { StreamRecordingSnapshot } from "@/shared/stream-recording-types";
import { installElectronAPIMock } from "../test-utils";

// Guards: any number of recording status consumers share one main-process state listener
// Guards: the initial snapshot and later lifecycle events reach every mounted consumer
// Guards: phase and quality live regions exclude ticking captured duration
// Guards: each typed quality-change revision is announced once from the root provider
// Guards: the root recovery alert owns the Interrupted announcement without a duplicate phase live region
describe("useStreamRecordingState", () => {
  it("lets the root provider share one IPC subscription across consumers", async () => {
    const api = installElectronAPIMock();
    const initial: StreamRecordingSnapshot = { active: null, notice: null };
    let emit: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    api.streamRecording.getState = vi.fn(async () => initial);
    api.streamRecording.onStateChanged = vi.fn((listener) => {
      emit = listener;
      return unsubscribe;
    });

    function Consumer({ label }: { label: string }) {
      const recording = useStreamRecordingState();
      return (
        <span>
          {label}:{recording.phase}
        </span>
      );
    }

    const view = render(
      <StreamRecordingProvider>
        <Consumer label="first" />
        <Consumer label="second" />
      </StreamRecordingProvider>
    );

    await waitFor(() => expect(api.streamRecording.getState).toHaveBeenCalledTimes(1));
    expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1);

    act(() => {
      emit?.({
        active: {
          sessionId: "recording-session-1",
          platform: "twitch",
          channelName: "ninja",
          title: "Ranked",
          status: "recording",
          qualityLabel: "720p60",
          desiredQualityLabel: "Source",
          currentQualityLabel: "720p60",
          qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
          capturedDurationSeconds: 1122,
        },
        notice: null,
      });
    });

    expect(screen.getByText("first:recording")).toBeVisible();
    expect(screen.getByText("second:recording")).toBeVisible();
    expect(screen.getByTestId("recording-phase-announcer")).toHaveTextContent(
      "Stream recording: Recording"
    );
    expect(screen.getByTestId("recording-phase-announcer")).not.toHaveTextContent("18:42");
    expect(screen.getByTestId("recording-quality-announcer")).toHaveTextContent(
      "Quality changed from Source to 720p60"
    );
    expect(screen.getByTestId("recording-quality-announcer")).not.toHaveTextContent("18:42");

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the quality live region again for duration pushes at the same revision", async () => {
    const api = installElectronAPIMock();
    let emit: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    api.streamRecording.getState = vi.fn(async () => ({ active: null, notice: null }));
    api.streamRecording.onStateChanged = vi.fn((listener) => {
      emit = listener;
      return vi.fn();
    });
    render(
      <StreamRecordingProvider>
        <span>child</span>
      </StreamRecordingProvider>
    );
    await waitFor(() => expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1));
    const snapshot = (
      revision: number,
      capturedDurationSeconds: number
    ): StreamRecordingSnapshot => ({
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Ranked",
        status: "recording",
        capturedDurationSeconds,
        qualityLabel: "720p60",
        qualityChange: {
          revision,
          fromQuality: revision === 1 ? "Source" : "720p60",
          toQuality: revision === 1 ? "720p60" : "480p30",
        },
      },
      notice: null,
    });

    act(() => emit?.(snapshot(1, 10)));
    const announcer = screen.getByTestId("recording-quality-announcer");
    const mutations = vi.fn();
    const recordingObserver = new MutationObserver(mutations);
    recordingObserver.observe(announcer, { childList: true, characterData: true, subtree: true });

    act(() => emit?.(snapshot(1, 11)));
    await Promise.resolve();
    expect(mutations).not.toHaveBeenCalled();

    act(() => emit?.(snapshot(2, 11)));
    await waitFor(() =>
      expect(announcer).toHaveTextContent("Quality changed from 720p60 to 480p30")
    );
    expect(mutations).toHaveBeenCalledTimes(1);
    recordingObserver.disconnect();
  });

  it("does not let late hydration overwrite a newer pushed state", async () => {
    const api = installElectronAPIMock();
    let resolveHydration: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    let emit: ((snapshot: StreamRecordingSnapshot) => void) | undefined;
    api.streamRecording.getState = vi.fn(
      () => new Promise<StreamRecordingSnapshot>((resolve) => (resolveHydration = resolve))
    );
    api.streamRecording.onStateChanged = vi.fn((listener) => {
      emit = listener;
      return vi.fn();
    });

    function Consumer() {
      return <span>{useStreamRecordingState().phase}</span>;
    }

    render(
      <StreamRecordingProvider>
        <Consumer />
      </StreamRecordingProvider>
    );
    await waitFor(() => expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1));

    act(() => {
      emit?.({
        active: {
          platform: "kick",
          channelName: "xqc",
          title: "Live",
          status: "reconnecting",
          capturedDurationSeconds: 40,
        },
        notice: null,
      });
    });
    expect(screen.getByText("reconnecting")).toBeVisible();

    await act(async () => {
      resolveHydration?.({ active: null, notice: null });
    });
    expect(screen.getByText("reconnecting")).toBeVisible();
  });

  it.each([
    "completed",
    "partial",
    "failed",
  ] as const)("represents a %s terminal outcome explicitly", async (outcome) => {
    const api = installElectronAPIMock();
    api.streamRecording.onStateChanged = vi.fn(() => vi.fn());
    api.streamRecording.getState = vi.fn(async () => ({
      active: null,
      notice: {
        sessionId: "recording-session-1",
        platform: "twitch" as const,
        channelName: "ninja",
        title: "Ranked",
        outcome,
        outputPath: "D:/Videos/ninja.mp4",
      },
    }));

    function Consumer() {
      return <span data-testid="terminal-phase">{useStreamRecordingState().phase}</span>;
    }

    render(
      <StreamRecordingProvider>
        <Consumer />
      </StreamRecordingProvider>
    );

    await waitFor(() => expect(screen.getByTestId("terminal-phase")).toHaveTextContent(outcome));
    expect(screen.queryByTestId("recording-phase-announcer")).toBeNull();
  });

  it("leaves Interrupted announcement ownership to the root recovery alert", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.onStateChanged = vi.fn(() => vi.fn());
    api.streamRecording.getState = vi.fn(async () => ({
      active: {
        sessionId: "recording-session-1",
        platform: "twitch" as const,
        channelName: "ninja",
        title: "Ranked",
        status: "interrupted" as const,
      },
      notice: null,
    }));

    render(
      <StreamRecordingProvider>
        <span>child</span>
      </StreamRecordingProvider>
    );

    await waitFor(() => expect(api.streamRecording.getState).toHaveBeenCalled());
    expect(screen.queryByTestId("recording-phase-announcer")).toBeNull();
  });
});
