import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingStopControl } from "@/components/recording/recording-stop-control";
import type { StreamRecordingLifecycleState } from "@/shared/stream-recording-types";
import { renderWithProviders, userEvent } from "../../test-utils";

const mocks = vi.hoisted(() => ({
  state: {
    phase: "recording",
    active: {
      sessionId: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Ranked with chat",
      status: "recording",
      capturedDurationSeconds: 42,
    },
    notice: null,
  } as StreamRecordingLifecycleState,
  stop: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/hooks/use-stream-recording-state", () => ({
  useStreamRecordingState: () => mocks.state,
}));
vi.mock("@/hooks/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => ({ stop: mocks.stop }),
}));

// Guards: every Stop surface uses the same safe confirmation and never mutates before confirmation.
describe("RecordingStopControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
      phase: "recording",
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Ranked with chat",
        status: "recording",
        capturedDurationSeconds: 42,
      },
      notice: null,
    };
  });

  it.each([
    "player",
    "global",
  ] as const)("keeps recording by default and restores focus on the %s surface", async (surface) => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingStopControl surface={surface} />);
    const trigger = screen.getByRole("button", { name: "Stop recording" });

    await user.click(trigger);
    expect(screen.getByRole("alertdialog", { name: "Stop recording?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep Recording" })).toHaveFocus();
    expect(mocks.stop).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog", { name: "Stop recording?" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.stop).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Keep Recording" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("confirms exactly one Stop command for the current session", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingStopControl surface="player" />);

    await user.click(screen.getByRole("button", { name: "Stop recording" }));
    await user.click(screen.getByRole("button", { name: "Stop and Save" }));

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledWith("recording-session-1");
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("portals the player confirmation inside the active fullscreen surface", async () => {
    const user = userEvent.setup();
    const fullscreenSurface = document.createElement("div");
    document.body.append(fullscreenSurface);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: fullscreenSurface,
    });
    renderWithProviders(<RecordingStopControl surface="player" />);

    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    expect(
      fullscreenSurface.contains(screen.getByRole("alertdialog", { name: "Stop recording?" }))
    ).toBe(true);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    fullscreenSurface.remove();
  });

  it.each([
    "preparing",
    "recording",
    "paused",
    "reconnecting",
  ] as const)("offers confirmed Stop while %s", (phase) => {
    mocks.state = {
      ...mocks.state,
      phase,
      active: mocks.state.active ? { ...mocks.state.active, status: phase } : null,
    } as StreamRecordingLifecycleState;

    renderWithProviders(<RecordingStopControl surface="player" />);

    expect(screen.getByRole("button", { name: "Stop recording" })).toBeVisible();
  });
});
