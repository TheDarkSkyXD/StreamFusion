import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecordingOutcomeNotice } from "@/features/media-library/components/recording/recording-completion-notice";
import { renderWithProviders, userEvent } from "../../test-utils";

const actions = vi.hoisted(() => ({
  openCompleted: vi.fn(async () => ({ success: true })),
  showCompleted: vi.fn(async () => ({ success: true })),
  dismissNotice: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/features/media-library/data/use-stream-recording-actions", () => ({
  useStreamRecordingActions: () => actions,
}));

// Guards: completion actions remain transient and recording-scoped, never routed to Downloads.
describe("RecordingOutcomeNotice", () => {
  it("truthfully presents fallback output and both file actions", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecordingOutcomeNotice
        notice={{
          outcome: "completed",
          sessionId: "recording-session-1",
          platform: "twitch",
          channelName: "ninja",
          title: "Ranked",
          outputPath: "D:/Videos/Ranked.ts",
          outputFormat: "ts",
          usedFallback: true,
          artifactIdentity: { algorithm: "sha256", digest: "owned", size: 1 },
          delivery: "in-app",
        }}
      />
    );

    expect(screen.getByText("Recording saved as TS fallback")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open recording" }));
    await user.click(screen.getByRole("button", { name: "Show recording in folder" }));

    expect(actions.openCompleted).toHaveBeenCalledWith("recording-session-1");
    expect(actions.showCompleted).toHaveBeenCalledWith("recording-session-1");
    await user.click(screen.getByRole("button", { name: "Dismiss recording notice" }));
    expect(actions.dismissNotice).toHaveBeenCalledWith("recording-session-1");
    expect(screen.queryByText("Downloads")).toBeNull();
  });

  it("presents Partial with file actions and Failed without phantom actions", () => {
    const { rerender } = renderWithProviders(
      <RecordingOutcomeNotice
        notice={{
          outcome: "partial",
          sessionId: "recording-session-1",
          platform: "kick",
          channelName: "xqc",
          title: "Live",
          outputPath: "D:/Videos/Live.ts",
          outputFormat: "ts",
          artifactIdentity: { algorithm: "sha256", digest: "owned", size: 1 },
          error: "Stream access was lost",
          delivery: "in-app",
        }}
      />
    );

    expect(screen.getByText("Partial recording saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open recording" })).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    rerender(
      <RecordingOutcomeNotice
        notice={{
          outcome: "failed",
          sessionId: "recording-session-2",
          platform: "kick",
          channelName: "xqc",
          title: "Live",
          error: "No playable output",
          delivery: "in-app",
        }}
      />
    );

    expect(screen.getByText("Recording failed")).toBeVisible();
    expect(screen.getByText("No playable output")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show recording in folder" })).toBeNull();
  });

  it("does not render native-only or suppressed outcomes in-app", () => {
    const notice = {
      outcome: "failed" as const,
      sessionId: "recording-session-1",
      platform: "twitch" as const,
      channelName: "ninja",
      title: "Ranked",
      error: "No playable output",
      delivery: "native" as const,
    };
    const { rerender } = renderWithProviders(<RecordingOutcomeNotice notice={notice} />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<RecordingOutcomeNotice notice={{ ...notice, delivery: "none" }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
