import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingRecoveryDialog } from "@/features/media-library/components/recording/recording-recovery-dialog";
import type {
  StreamRecordingLifecycleState,
  StreamRecordingRecoveryActionResult,
} from "@shared/stream-recording-types";
import { renderWithProviders, userEvent } from "../../test-utils";

const mocks = vi.hoisted(() => ({
  state: {
    phase: "interrupted",
    active: {
      sessionId: "recording-restart-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Championship run",
      status: "interrupted",
      capturedDurationSeconds: 3723,
      desiredQualityLabel: "Source",
      currentQualityLabel: "720p60",
      gapCount: 2,
      hasOpenGap: true,
      statusMessage: "Recording interrupted when StreamFusion closed",
      partial: true,
    },
    notice: null,
  } as StreamRecordingLifecycleState,
  resumeInterrupted: vi.fn<() => Promise<StreamRecordingRecoveryActionResult>>(async () => ({
    success: true,
  })),
  finalizeInterrupted: vi.fn<() => Promise<StreamRecordingRecoveryActionResult>>(async () => ({
    success: true,
  })),
  dismissInterrupted: vi.fn<() => Promise<StreamRecordingRecoveryActionResult>>(async () => ({
    success: true,
  })),
}));

vi.mock("@/features/media-library/data/use-stream-recording-state", () => ({
  useStreamRecordingState: () => mocks.state,
}));
vi.mock("@/features/media-library/data/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => ({
    resumeInterrupted: mocks.resumeInterrupted,
    finalizeInterrupted: mocks.finalizeInterrupted,
    dismissInterrupted: mocks.dismissInterrupted,
  }),
}));

// Guards: an interrupted session is a root modal with stream, duration, quality, and gap context.
// Guards: Escape/backdrop cannot silently discard recovery and Dismiss requires a second confirmation.
// Guards: recovery commands expose focused, keyboard-accessible pending state without Downloads history.
// Guards: transient recovery UI state never leaks from one interrupted session into the next.
describe("RecordingRecoveryDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows recovery context, focuses Resume, and cannot be dismissed with Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    expect(screen.getByRole("alertdialog", { name: "Recording interrupted" })).toBeVisible();
    expect(screen.getByText("Championship run")).toBeVisible();
    expect(screen.getByText(/ninja · Twitch/)).toBeVisible();
    expect(screen.getByText("1:02:03 captured")).toBeVisible();
    expect(screen.getByText("Source selected · 720p60 current")).toBeVisible();
    expect(screen.getByText("2 gaps · restart gap open")).toBeVisible();
    expect(screen.getByRole("button", { name: /check stream and resume/i })).toHaveFocus();
    expect(screen.queryByText("Downloads")).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Recording interrupted" })).toBeVisible();

    const backdrop = document.querySelector<HTMLElement>(".fixed.inset-0.z-50");
    expect(backdrop).not.toBeNull();
    if (backdrop) fireEvent.pointerDown(backdrop);
    expect(screen.getByRole("alertdialog", { name: "Recording interrupted" })).toBeVisible();
  });

  it("shows and announces Finalizing while the partial output is being assembled", async () => {
    let resolveFinalize: (result: { success: true }) => void = () => undefined;
    mocks.finalizeInterrupted.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalize = resolve;
        })
    );
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: /finalize partial/i }));

    expect(screen.getByRole("button", { name: "Finalizing" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Finalizing partial recording");

    await act(async () => resolveFinalize({ success: true }));
  });

  it("runs Check & Resume and Finalize Partial from explicit buttons", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: /check stream and resume/i }));
    expect(mocks.resumeInterrupted).toHaveBeenCalledWith("recording-restart-1");

    await user.click(screen.getByRole("button", { name: /finalize partial/i }));
    expect(mocks.finalizeInterrupted).toHaveBeenCalledWith("recording-restart-1");
  });

  it("disables Resume and focuses Finalize when the stream check reports unavailable", async () => {
    mocks.resumeInterrupted.mockResolvedValueOnce({
      success: false,
      code: "stream-unavailable",
      error: "Stream is offline",
    });
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: /check stream and resume/i }));

    expect(screen.getByText(/stream unavailable.*captured footage is safe/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /check stream and resume/i })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /finalize partial/i })).toHaveFocus()
    );
  });

  it("explains that a different Stream cannot be appended to the recovered footage", async () => {
    mocks.resumeInterrupted.mockResolvedValueOnce({
      success: false,
      code: "stream-changed",
      error: "This Channel is now showing a different Stream",
    });
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: /check stream and resume/i }));

    expect(screen.getByText(/different stream.*will not be appended/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /check stream and resume/i })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /finalize partial/i })).toHaveFocus()
    );
  });

  it("clears pending state and restores Finalize focus after failure or rejection", async () => {
    mocks.finalizeInterrupted
      .mockResolvedValueOnce({
        success: false,
        code: "finalize-failed",
        error: "Could not assemble sections",
      })
      .mockRejectedValueOnce(new Error("IPC disconnected"));
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);
    const finalize = screen.getByRole("button", { name: /finalize partial/i });

    await user.click(finalize);
    await waitFor(() => expect(finalize).toHaveFocus());
    expect(finalize).toBeEnabled();

    await user.click(finalize);
    await waitFor(() => expect(finalize).toHaveFocus());
    expect(finalize).toBeEnabled();
  });

  it("requires a visible confirmation before dismissing and states that files remain", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: "Dismiss recovery" }));
    expect(screen.getByRole("heading", { name: "Dismiss recording recovery?" })).toBeVisible();
    expect(screen.getByText(/captured section files will remain/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep recovery" })).toHaveFocus();
    expect(mocks.dismissInterrupted).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep recovery" }));
    expect(screen.getByRole("button", { name: "Dismiss recovery" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Dismiss recovery" }));

    await user.click(screen.getByRole("button", { name: "Dismiss recovery permanently" }));
    expect(mocks.dismissInterrupted).toHaveBeenCalledWith("recording-restart-1");
  });

  it.each([
    "commit-intent",
    "pending-probe",
  ] as const)("offers only Finalize Partial for a %s recovery checkpoint", (recoveryExhaustionState) => {
    const previousState = mocks.state;
    mocks.state = {
      ...mocks.state,
      active: {
        ...mocks.state.active,
        recoveryExhaustionState,
        recoveryFinalizeOnly: true,
      },
    } as StreamRecordingLifecycleState;

    try {
      renderWithProviders(<RecordingRecoveryDialog />);

      expect(screen.queryByRole("button", { name: /check stream and resume/i })).toBeNull();
      expect(screen.getByText(/finalization already started.*finalize partial/i)).toBeVisible();
      expect(screen.getByRole("button", { name: /finalize partial/i })).toHaveFocus();
    } finally {
      mocks.state = previousState;
    }
  });

  it("offers only Finalize Partial when a legacy recovery cannot verify Stream identity", () => {
    const previousState = mocks.state;
    mocks.state = {
      ...mocks.state,
      active: {
        ...mocks.state.active,
        recoveryFinalizeOnly: true,
        recoveryResumeEligible: false,
        recoveryResumeUnavailableReason: "missing-stream-identity",
      },
    } as StreamRecordingLifecycleState;

    try {
      renderWithProviders(<RecordingRecoveryDialog />);

      expect(screen.queryByRole("button", { name: /check stream and resume/i })).toBeNull();
      expect(screen.getByText(/cannot verify that the same stream is still live/i)).toBeVisible();
      expect(screen.getByRole("button", { name: /finalize partial/i })).toHaveFocus();
      expect(screen.queryByText("Downloads")).toBeNull();
    } finally {
      mocks.state = previousState;
    }
  });

  it("resets an unavailable Resume check when a different interrupted session appears", async () => {
    mocks.resumeInterrupted.mockResolvedValueOnce({
      success: false,
      code: "stream-unavailable",
      error: "Stream is offline",
    });
    const user = userEvent.setup();
    const view = renderWithProviders(<RecordingRecoveryDialog />);

    await user.click(screen.getByRole("button", { name: /check stream and resume/i }));
    expect(screen.getByRole("button", { name: /check stream and resume/i })).toBeDisabled();

    mocks.state = {
      ...mocks.state,
      active: {
        ...mocks.state.active,
        sessionId: "recording-restart-2",
        title: "Second interrupted recording",
      },
    } as StreamRecordingLifecycleState;
    view.rerender(<RecordingRecoveryDialog />);

    expect(screen.getByText("Second interrupted recording")).toBeVisible();
    expect(screen.getByRole("button", { name: /check stream and resume/i })).toBeEnabled();
  });
});
