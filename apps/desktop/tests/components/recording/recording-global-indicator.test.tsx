import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

import { RecordingGlobalIndicator } from "@/features/media-library/components/recording/recording-global-indicator";
import type { StreamRecordingLifecycleState } from "@shared/stream-recording-types";
import { renderWithProviders, userEvent } from "../../test-utils";

const state = vi.hoisted(() => ({
  current: {
    phase: "recording",
    active: {
      sessionId: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Ranked with chat",
      status: "recording",
      qualityLabel: "1080p60",
      capturedDurationSeconds: 1122,
    },
    notice: null,
  } as StreamRecordingLifecycleState,
}));
const commands = vi.hoisted(() => ({
  pause: vi.fn(async () => ({ success: true })),
  resume: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/features/media-library/data/use-stream-recording-state", () => ({
  useStreamRecordingState: () => state.current,
}));
vi.mock("@/features/media-library/data/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => commands,
}));

// Guards: active recording phases stay identifiable in app chrome and expose View without Downloads
// Guards: future Pause, Resume, and Stop behavior enters through named control slots, not premature actions
describe("RecordingGlobalIndicator", () => {
  it("opens Stream details with View and supplied control slots", () => {
    renderWithProviders(
      <RecordingGlobalIndicator
        pauseControl={<button type="button">Pause slot</button>}
        stopControl={<button type="button">Stop slot</button>}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Stream recording, Recording, ninja on Twitch, 18:42 captured, show details",
    });
    expect(trigger).toHaveClass("motion-reduce:transition-none");
    expect(trigger.querySelector("[aria-hidden='true']")).toHaveClass("motion-reduce:animate-none");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ranked with chat")).toBeVisible();
    expect(screen.getByText("ninja · Twitch")).toBeVisible();
    expect(screen.getByText("18:42 captured · 1080p60")).toBeVisible();
    expect(screen.getByRole("link", { name: "View recording" })).toHaveAttribute(
      "href",
      "/stream/twitch/ninja"
    );
    expect(screen.getByRole("button", { name: "Pause slot" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop slot" })).toBeVisible();
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("manages focus and dismisses on Escape, outside interaction, and View", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div>
        <RecordingGlobalIndicator />
        <button type="button">Outside</button>
      </div>
    );
    const trigger = screen.getByRole("button", { name: /Stream recording.*show details/i });

    fireEvent.click(trigger);
    const viewLink = screen.getByRole("link", { name: "View recording" });
    expect(viewLink).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Recording details" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog", { name: "Recording details" })).toBeNull();

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("link", { name: "View recording" })).toHaveFocus();
    await user.click(screen.getByRole("link", { name: "View recording" }));
    expect(screen.queryByRole("dialog", { name: "Recording details" })).toBeNull();
  });

  it("keeps the global details surface mounted while Keep Recording cancels Stop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingGlobalIndicator />);
    await user.click(screen.getByRole("button", { name: /Stream recording.*show details/i }));
    const stop = screen.getByRole("button", { name: "Stop recording" });

    await user.click(stop);
    expect(screen.getByRole("button", { name: "Keep Recording" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep Recording" }));

    expect(screen.getByRole("dialog", { name: "Recording details" })).toBeVisible();
    await waitFor(() => expect(stop).toHaveFocus());
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("closes only the nested Stop dialog on Escape and restores focus to Stop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingGlobalIndicator />);
    await user.click(screen.getByRole("button", { name: /Stream recording.*show details/i }));
    const stop = screen.getByRole("button", { name: "Stop recording" });
    await user.click(stop);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog", { name: "Stop recording?" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Recording details" })).toBeVisible();
    await waitFor(() => expect(stop).toHaveFocus());
  });

  it("shows the current-session gap summary and default global Resume command", () => {
    state.current = {
      ...state.current,
      phase: "paused",
      active: state.current.active
        ? { ...state.current.active, status: "paused", gapCount: 1, hasOpenGap: true }
        : null,
    } as StreamRecordingLifecycleState;
    renderWithProviders(<RecordingGlobalIndicator />);

    fireEvent.click(screen.getByRole("button", { name: /Stream recording.*show details/i }));

    expect(screen.getByText("Current session: 1 gap · current gap open")).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume recording" })).toHaveAttribute(
      "data-recording-control-surface",
      "global"
    );
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("shows one typed quality-change revision in global status details", () => {
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
    renderWithProviders(<RecordingGlobalIndicator />);

    fireEvent.click(screen.getByRole("button", { name: /Stream recording.*show details/i }));

    const change = screen.getByText("Quality changed Source → 720p60");
    expect(change).toHaveAttribute("data-quality-change-revision", "1");
    expect(change).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByText(/Quality changed/)).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("runs the real global Resume command and restores focus to Pause after the phase changes", async () => {
    const user = userEvent.setup();
    commands.resume.mockClear();
    state.current = {
      ...state.current,
      phase: "paused",
      active: state.current.active
        ? { ...state.current.active, status: "paused", gapCount: 1, hasOpenGap: true }
        : null,
    } as StreamRecordingLifecycleState;
    const view = renderWithProviders(<RecordingGlobalIndicator />);
    await user.click(screen.getByRole("button", { name: /Stream recording.*show details/i }));

    await user.click(screen.getByRole("button", { name: "Resume recording" }));
    expect(commands.resume).toHaveBeenCalledWith("recording-session-1");

    state.current = {
      ...state.current,
      phase: "preparing",
      active: state.current.active
        ? { ...state.current.active, status: "preparing", statusMessage: "Resuming" }
        : null,
    } as StreamRecordingLifecycleState;
    view.rerender(<RecordingGlobalIndicator />);
    expect(screen.getByRole("button", { name: "Resume recording" })).toBeDisabled();

    state.current = {
      ...state.current,
      phase: "recording",
      active: state.current.active
        ? { ...state.current.active, status: "recording", hasOpenGap: false }
        : null,
    } as StreamRecordingLifecycleState;
    view.rerender(<RecordingGlobalIndicator />);

    expect(screen.getByRole("button", { name: "Pause recording" })).toHaveFocus();
  });

  it.each([
    "preparing",
    "recording",
    "reconnecting",
    "paused",
    "finalizing",
  ] as const)("keeps the global pill visible while %s", (phase) => {
    state.current = {
      ...state.current,
      phase,
      active: state.current.active ? { ...state.current.active, status: phase } : null,
    } as StreamRecordingLifecycleState;
    renderWithProviders(<RecordingGlobalIndicator />);
    expect(screen.getByRole("button", { name: new RegExp(phase, "i") })).toBeVisible();
  });
});
