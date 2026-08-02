import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingPauseResumeControl } from "@/components/recording/recording-session-control";
import type { StreamRecordingLifecycleState } from "@/shared/stream-recording-types";
import { renderWithProviders, userEvent } from "../../test-utils";

const mocks = vi.hoisted(() => ({
  state: {
    phase: "recording",
    active: {
      sessionId: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Stream",
      status: "recording",
      capturedDurationSeconds: 12,
      gapCount: 0,
      hasOpenGap: false,
    },
    notice: null,
  } as StreamRecordingLifecycleState,
  pause: vi.fn(async () => ({ success: true })),
  resume: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/hooks/use-stream-recording-state", () => ({
  useStreamRecordingState: () => mocks.state,
}));
vi.mock("@/hooks/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => ({ pause: mocks.pause, resume: mocks.resume }),
}));

describe("RecordingPauseResumeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
      phase: "recording",
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status: "recording",
        capturedDurationSeconds: 12,
        gapCount: 0,
        hasOpenGap: false,
      },
      notice: null,
    };
  });

  it("runs the current session command from the player and restores focus after the phase changes", async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<RecordingPauseResumeControl surface="player" />);

    await user.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(mocks.pause).toHaveBeenCalledWith("recording-session-1");

    mocks.state = {
      ...mocks.state,
      phase: "paused",
      active: mocks.state.active ? { ...mocks.state.active, status: "paused" } : null,
    } as StreamRecordingLifecycleState;
    view.rerender(<RecordingPauseResumeControl surface="player" />);

    const resume = screen.getByRole("button", { name: "Resume recording" });
    expect(resume).toHaveFocus();
    await user.click(resume);
    expect(mocks.resume).toHaveBeenCalledWith("recording-session-1");
    expect(screen.queryByText("Downloads")).toBeNull();
  });
});
