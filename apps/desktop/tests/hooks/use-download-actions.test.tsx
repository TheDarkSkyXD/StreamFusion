import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadDuplicateConfirmationDialog } from "@/components/download-duplicate-confirmation-dialog";
import { useDownloadActions } from "@/hooks/use-download-actions";
import type {
  ClipDownloadRequest,
  DownloadJob,
  VideoDownloadRequest,
} from "@/shared/download-types";
import { installElectronAPIMock, renderWithProviders, userEvent } from "../test-utils";

const clipRequest: ClipDownloadRequest = {
  platform: "twitch",
  clipId: "clip-123",
  title: "Championship play",
  channelName: "streamer",
};

const videoRequest: VideoDownloadRequest = {
  platform: "kick",
  videoId: "vod-456",
  title: "Friday night VOD",
  channelName: "creator",
};

function duplicateJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    kind: "clip",
    platform: "twitch",
    sourceId: "clip-123",
    title: "Championship play",
    channelName: "streamer",
    status: "completed",
    progress: { percent: 100, transferredBytes: 1024, totalBytes: 1024 },
    destinationPath: "C:\\Downloads\\championship-play.mp4",
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:01:00.000Z",
    ...overrides,
  };
}

// Guards: duplicate clip and VOD downloads require an accessible in-app decision before another copy starts.
// Guards: cancelling or dismissing the duplicate decision never starts another download.
// Guards: only one duplicate decision can be pending so rapid clicks cannot start the wrong download.
describe("useDownloadActions duplicate confirmation", () => {
  let electronApi: ReturnType<typeof installElectronAPIMock>;

  beforeEach(() => {
    electronApi = installElectronAPIMock();
    electronApi.downloads.getQueue = vi.fn(async () => ({ jobs: [duplicateJob()] }));
    electronApi.downloads.downloadClip = vi.fn(async () => ({ success: true, jobId: "job-2" }));
  });

  it("shows the app dialog and leaves a duplicate clip untouched when cancelled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DownloadDuplicateConfirmationDialog />);
    const { result } = renderHook(() => useDownloadActions());

    act(() => {
      void result.current.downloadClip(clipRequest);
    });

    expect(await screen.findByRole("alertdialog", { name: "Already in Downloads" })).toBeVisible();
    expect(screen.getByText(/Championship play/)).toBeVisible();
    expect(screen.getByText(/clip/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(electronApi.downloads.downloadClip).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog", { name: "Already in Downloads" })).toBeNull();
    expect(electronApi.downloads.downloadClip).not.toHaveBeenCalled();
  });

  it("starts the requested VOD only after Download again is chosen", async () => {
    electronApi.downloads.getQueue = vi.fn(async () => ({
      jobs: [
        duplicateJob({
          kind: "video",
          platform: "kick",
          sourceId: "vod-456",
          title: "Friday night VOD",
        }),
      ],
    }));
    electronApi.downloads.downloadVideo = vi.fn(async () => ({
      success: true,
      jobId: "job-3",
    }));
    const user = userEvent.setup();
    renderWithProviders(<DownloadDuplicateConfirmationDialog />);
    const { result } = renderHook(() => useDownloadActions());

    act(() => {
      void result.current.downloadVideo(videoRequest);
    });

    expect(await screen.findByText(/Friday night VOD/)).toBeVisible();
    expect(screen.getByText(/Download this VOD again/)).toBeVisible();
    expect(electronApi.downloads.downloadVideo).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Download again" }));

    expect(electronApi.downloads.downloadVideo).toHaveBeenCalledWith(videoRequest);
    expect(screen.queryByRole("alertdialog", { name: "Already in Downloads" })).toBeNull();
  });

  it("treats Escape and backdrop dismissal as cancellation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DownloadDuplicateConfirmationDialog />);
    const { result } = renderHook(() => useDownloadActions());

    act(() => {
      void result.current.downloadClip(clipRequest);
    });
    await screen.findByRole("alertdialog", { name: "Already in Downloads" });
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Cancel",
      "Download again",
    ]);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Already in Downloads" })).toBeNull()
    );
    expect(electronApi.downloads.downloadClip).not.toHaveBeenCalled();

    act(() => {
      void result.current.downloadClip(clipRequest);
    });
    await screen.findByRole("alertdialog", { name: "Already in Downloads" });
    const backdrop = document.querySelector<HTMLElement>(".fixed.inset-0.z-50");
    expect(backdrop).not.toBeNull();
    if (backdrop) await user.click(backdrop);

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Already in Downloads" })).toBeNull()
    );
    expect(electronApi.downloads.downloadClip).not.toHaveBeenCalled();
  });

  it("keeps the first duplicate decision when another request arrives", async () => {
    electronApi.downloads.getQueue = vi.fn(async () => ({
      jobs: [
        duplicateJob(),
        duplicateJob({
          id: "job-video",
          kind: "video",
          platform: "kick",
          sourceId: "vod-456",
          title: "Friday night VOD",
        }),
      ],
    }));
    electronApi.downloads.downloadVideo = vi.fn(async () => ({
      success: true,
      jobId: "job-video-copy",
    }));
    const user = userEvent.setup();
    renderWithProviders(<DownloadDuplicateConfirmationDialog />);
    const { result } = renderHook(() => useDownloadActions());

    act(() => {
      void result.current.downloadClip(clipRequest);
    });
    expect(await screen.findByText(/Championship play/)).toBeVisible();

    act(() => {
      void result.current.downloadVideo(videoRequest);
    });

    await waitFor(() => expect(screen.queryByText(/Friday night VOD/)).toBeNull());
    expect(screen.getByText(/Championship play/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Download again" }));

    await waitFor(() =>
      expect(electronApi.downloads.downloadClip).toHaveBeenCalledWith(clipRequest)
    );
    expect(electronApi.downloads.downloadVideo).not.toHaveBeenCalled();
  });

  it("continues to download directly when the only matching job was cancelled", async () => {
    electronApi.downloads.getQueue = vi.fn(async () => ({
      jobs: [duplicateJob({ status: "cancelled" })],
    }));
    renderWithProviders(<DownloadDuplicateConfirmationDialog />);
    const { result } = renderHook(() => useDownloadActions());

    await act(async () => {
      await result.current.downloadClip(clipRequest);
    });

    expect(screen.queryByRole("alertdialog", { name: "Already in Downloads" })).toBeNull();
    expect(electronApi.downloads.downloadClip).toHaveBeenCalledWith(clipRequest);
  });
});
