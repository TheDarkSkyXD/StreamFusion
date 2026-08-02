import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecordingPlayerStatus } from "@/components/player/recording-player-status";
import type { StreamRecordingLifecycleState } from "@/shared/stream-recording-types";

const state = vi.hoisted(() => ({
  current: {
    phase: "recording",
    active: {
      sessionId: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Ranked",
      status: "recording",
      qualityLabel: "1080p60",
      capturedDurationSeconds: 1122,
    },
    notice: null,
  } as StreamRecordingLifecycleState,
}));

vi.mock("@/hooks/use-stream-recording-state", () => ({
  useStreamRecordingState: () => state.current,
}));

// Guards: the matching live player presents typed lifecycle, selected quality, and captured footage time
// Guards: recording status remains in the shared player controls for normal, theater, and fullscreen modes
describe("RecordingPlayerStatus", () => {
  it("shows the matching Stream recording details", () => {
    const { rerender } = render(
      <RecordingPlayerStatus platform="twitch" channelName="ninja" mode="normal" />
    );

    expect(screen.getByText("Recording 18:42 captured")).toBeVisible();
    expect(screen.getByText("1080p60")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Recording 18:42 captured").previousElementSibling).toHaveClass(
      "motion-reduce:animate-none"
    );

    rerender(<RecordingPlayerStatus platform="twitch" channelName="ninja" mode="theater" />);
    expect(screen.getByText("Recording 18:42 captured")).toBeVisible();

    rerender(<RecordingPlayerStatus platform="twitch" channelName="ninja" mode="fullscreen" />);
    expect(screen.getByText("Recording 18:42 captured")).toBeVisible();
  });

  it("does not show another Stream's recording", () => {
    render(<RecordingPlayerStatus platform="kick" channelName="xqc" mode="normal" />);
    expect(screen.queryByText("Recording 18:42 captured")).toBeNull();
  });

  it("shows the current-session gap summary without permanently mounting commands", () => {
    state.current = {
      ...state.current,
      phase: "paused",
      active: state.current.active
        ? { ...state.current.active, status: "paused", gapCount: 2, hasOpenGap: true }
        : null,
    } as StreamRecordingLifecycleState;

    render(<RecordingPlayerStatus platform="twitch" channelName="ninja" mode="normal" />);

    expect(screen.getByText("2 gaps · current gap open")).toBeVisible();
    expect(screen.queryByRole("button", { name: /resume recording/i })).toBeNull();
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("shows one typed quality-change revision without adding an a11y announcement", () => {
    state.current = {
      ...state.current,
      phase: "recording",
      active: state.current.active
        ? {
            ...state.current.active,
            status: "recording",
            qualityLabel: "720p60",
            currentQualityLabel: "720p60",
            desiredQualityLabel: "Source",
            qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
          }
        : null,
    } as StreamRecordingLifecycleState;

    render(<RecordingPlayerStatus platform="twitch" channelName="ninja" mode="normal" />);

    const change = screen.getByText("Quality changed Source → 720p60");
    expect(change).toHaveAttribute("data-quality-change-revision", "1");
    expect(change).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByText(/Quality changed/)).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["preparing", "Preparing"],
    ["reconnecting", "Reconnecting"],
    ["paused", "Paused"],
    ["finalizing", "Finalizing"],
    ["interrupted", "Interrupted"],
  ] as const)("presents the %s lifecycle phase", (phase, label) => {
    state.current = {
      ...state.current,
      phase,
      active: state.current.active ? { ...state.current.active, status: phase } : null,
    } as StreamRecordingLifecycleState;

    render(<RecordingPlayerStatus platform="twitch" channelName="ninja" mode="normal" />);
    expect(screen.getByText(`${label} 18:42 captured`)).toBeVisible();
  });
});
