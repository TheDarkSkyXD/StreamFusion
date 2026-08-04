import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    children,
    ...props
  }: {
    params: { platform: string; channel: string };
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={`/stream/${params.platform}/${params.channel}`} {...props}>
      {children}
    </a>
  ),
}));

const recording = vi.hoisted(() => ({
  state: {
    phase: "idle",
    active: null,
    notice: null,
  } as import("@/shared/stream-recording-types").StreamRecordingLifecycleState,
  start: vi.fn(),
}));

vi.mock("@/hooks/use-stream-recording-state", () => ({
  useStreamRecordingState: () => recording.state,
}));

vi.mock("@/hooks/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => ({ start: recording.start }),
}));

import { StreamRecordingControl } from "@/components/recording/stream-recording-control";
import { renderWithProviders, screen, userEvent } from "../../test-utils";

// Guards: every playable live Stream exposes a watch-page Record action wired to the direct-to-file recording controller
// Guards: Record remains the crimson recording-entry action in the Dark Theater palette
// Guards: Record removes its color transition when the user requests reduced motion
// Guards: a blocked second recording identifies the active Stream and offers View Recording or Cancel without queuing
// Guards: returning to the recorded Stream replaces Record with its player-attached Pause and Stop controls
describe("StreamRecordingControl", () => {
  beforeEach(() => {
    recording.state = { phase: "idle", active: null, notice: null };
    recording.start.mockReset();
  });

  it("presents Record as the crimson recording-entry action", () => {
    renderWithProviders(
      <StreamRecordingControl
        platform="twitch"
        channelName="ninja"
        streamId="stream-live-123"
        title="Ranked with chat"
        isPlayable
      />
    );

    expect(screen.getByRole("button", { name: "Record stream" })).toHaveClass(
      "bg-[var(--color-destructive)]",
      "text-[var(--color-destructive-foreground)]"
    );
  });

  it("disables the Record color transition for reduced motion", () => {
    renderWithProviders(
      <StreamRecordingControl
        platform="twitch"
        channelName="ninja"
        streamId="stream-live-123"
        title="Ranked with chat"
        isPlayable
      />
    );

    expect(screen.getByRole("button", { name: "Record stream" })).toHaveClass(
      "motion-reduce:transition-none"
    );
  });

  it("uses a StreamFusion dialog to choose quality before starting the current Stream", async () => {
    recording.start.mockResolvedValue({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
    const user = userEvent.setup();

    renderWithProviders(
      <StreamRecordingControl
        platform="twitch"
        channelName="ninja"
        streamId="stream-live-123"
        title="Ranked with chat"
        isPlayable
      />
    );

    await user.click(screen.getByRole("button", { name: "Record stream" }));

    expect(screen.getByRole("dialog", { name: "Record ninja" })).toBeVisible();
    expect(recording.start).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "720p" }));
    await user.click(screen.getByRole("button", { name: "Choose save location" }));

    expect(recording.start).toHaveBeenCalledWith({
      platform: "twitch",
      channelName: "ninja",
      streamId: "stream-live-123",
      title: "Ranked with chat",
      desiredQuality: { quality: "720p", height: 720 },
    });
  });

  it("shows the existing recording when the single-recording controller blocks a second start", async () => {
    recording.start.mockResolvedValue({
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
    });
    const user = userEvent.setup();

    renderWithProviders(
      <StreamRecordingControl
        platform="twitch"
        channelName="ninja"
        streamId="stream-live-456"
        title="Second Stream"
        isPlayable
      />
    );

    await user.click(screen.getByRole("button", { name: "Record stream" }));
    await user.click(screen.getByRole("button", { name: "Choose save location" }));

    expect(screen.getByRole("dialog", { name: "A recording is already active" })).toBeVisible();
    expect(screen.getByText("xqc")).toBeVisible();
    expect(screen.getByText("Active Stream")).toBeVisible();
    expect(screen.getByRole("link", { name: "View Recording" })).toHaveAttribute(
      "href",
      "/stream/kick/xqc"
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("shows session controls instead of another start action for the active Stream", () => {
    recording.state = {
      phase: "recording",
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "Ninja",
        title: "Ranked with chat",
        status: "recording",
        qualityLabel: "1080p60",
        capturedDurationSeconds: 45,
      },
      notice: null,
    };

    renderWithProviders(
      <StreamRecordingControl
        platform="twitch"
        channelName="ninja"
        streamId="stream-live-123"
        title="Ranked with chat"
        isPlayable
      />
    );

    expect(screen.queryByRole("button", { name: "Record stream" })).toBeNull();
    expect(screen.getByText("Recording 0:45 captured / 1080p60")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause recording" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeVisible();
  });
});
