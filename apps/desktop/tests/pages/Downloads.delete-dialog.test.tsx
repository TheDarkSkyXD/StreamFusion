import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadsPage } from "@/pages/Downloads";
import type { DownloadJob } from "@shared/download-types";
import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../test-utils";

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "video-1",
    kind: "video",
    platform: "twitch",
    sourceId: "123",
    title: "Friday Night Finals",
    channelName: "speedrunpro",
    status: "completed",
    progress: { percent: 100, transferredBytes: 1, totalBytes: 1 },
    destinationPath: "D:\\Videos\\Friday Night Finals.mp4",
    thumbnailUrl: null,
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:01:00.000Z",
    ...overrides,
  };
}

let downloads: ReturnType<typeof installElectronAPIMock>["downloads"];

beforeEach(() => {
  const api = installElectronAPIMock();
  downloads = api.downloads;
  downloads.getQueue = vi.fn(async () => ({ jobs: [downloadJob()] }));
  downloads.onQueueChanged = vi.fn(() => vi.fn());
});

// Guards: clicking Delete from disk opens the custom alert dialog without invoking the delete IPC
// Guards: Cancel receives initial focus and idle dismissal restores focus to the connected delete button
// Guards: pending deletion blocks dismissal and duplicate submission until the IPC result settles
// Guards: returned and rejected delete failures remain visible and retryable without exposing a file path
// Guards: inactive partial files use partial-file copy while active partial downloads hide deletion
describe("DownloadsPage delete dialog", () => {
  it("prompts before deletion and restores focus after idle dismissal", async () => {
    downloads.deleteFile = vi.fn(async () => ({ success: true }));
    renderWithProviders(<DownloadsPage />);

    const deleteButton = await screen.findByRole("button", {
      name: "Delete Friday Night Finals from disk",
    });
    fireEvent.click(deleteButton);
    expect(downloads.deleteFile).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("This cannot be undone.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
  });

  it("locks pending deletion and retries returned or rejected failures", async () => {
    let resolveDelete: ((result: { success: boolean; error?: string }) => void) | undefined;
    downloads.deleteFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDelete = resolve;
          })
      )
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockResolvedValueOnce({ success: true });

    renderWithProviders(<DownloadsPage />);
    const deleteButton = await screen.findByRole("button", {
      name: "Delete Friday Night Finals from disk",
    });
    fireEvent.click(deleteButton);
    const confirm = await screen.findByRole("button", { name: "Delete from disk" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(downloads.deleteFile).toHaveBeenCalledOnce();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting..." })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => {
      resolveDelete?.({ success: false, error: "The file is in use." });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The file is in use.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("D:\\Videos");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(deleteButton);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Delete from disk" }));
    });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "StreamFusion couldn't delete the file. Try again."
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry delete" }));
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(downloads.deleteFile).toHaveBeenCalledTimes(3);
  });

  it("uses partial-file copy only for inactive partial downloads", async () => {
    downloads.getQueue = vi.fn(async () => ({
      jobs: [
        downloadJob({ id: "partial-1", title: "Stopped VOD", status: "paused", partial: true }),
        downloadJob({
          id: "active-partial",
          title: "Active VOD",
          status: "downloading",
          partial: true,
        }),
      ],
    }));

    renderWithProviders(<DownloadsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Stopped VOD from disk" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("partial download");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Remove from list keeps the file.");
    expect(
      screen.queryByRole("button", { name: "Delete Active VOD from disk" })
    ).not.toBeInTheDocument();
  });
});
