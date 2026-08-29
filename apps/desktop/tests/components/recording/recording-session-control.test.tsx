import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingPauseResumeControl } from "@/features/media-library/components/recording/recording-session-control";
import type { StreamRecordingLifecycleState } from "@shared/stream-recording-types";
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

vi.mock("@/features/media-library/data/use-stream-recording-state", () => ({
  useStreamRecordingState: () => mocks.state,
}));
vi.mock("@/features/media-library/data/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => ({ pause: mocks.pause, resume: mocks.resume }),
}));

// Guards: Pause is amber on both player and global recording surfaces
// Guards: Resume is green on both player and global recording surfaces
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

  it.each(["player", "global"] as const)("presents Pause as amber on the %s surface", (surface) => {
    renderWithProviders(<RecordingPauseResumeControl surface={surface} />);

    expect(screen.getByRole("button", { name: "Pause recording" })).toHaveClass(
      "bg-amber-400",
      "text-black",
      "hover:bg-amber-300",
      "motion-reduce:transition-none"
    );
  });

  it.each(["player", "global"] as const)(
    "presents Resume as green on the %s surface",
    (surface) => {
      mocks.state = {
        ...mocks.state,
        phase: "paused",
        active: mocks.state.active ? { ...mocks.state.active, status: "paused" } : null,
      } as StreamRecordingLifecycleState;

      renderWithProviders(<RecordingPauseResumeControl surface={surface} />);

      expect(screen.getByRole("button", { name: "Resume recording" })).toHaveClass(
        "bg-green-500",
        "text-black",
        "hover:bg-green-400",
        "motion-reduce:transition-none"
      );
    }
  );

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

  it("shows the durable Pausing transition without offering Resume early", () => {
    mocks.state = {
      ...mocks.state,
      phase: "paused",
      active: mocks.state.active
        ? { ...mocks.state.active, status: "paused", statusMessage: "Pausing" }
        : null,
    } as StreamRecordingLifecycleState;

    renderWithProviders(<RecordingPauseResumeControl surface="player" />);

    expect(screen.getByRole("button", { name: "Pausing recording" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Resume recording" })).toBeNull();
  });
});
