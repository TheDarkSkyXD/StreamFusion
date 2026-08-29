import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadsPage } from "@/pages/Downloads";
import type { DownloadJob } from "@shared/download-types";
import { fireEvent, installElectronAPIMock, renderWithProviders, screen } from "../test-utils";

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "video-1",
    kind: "video",
    platform: "twitch",
    sourceId: "123",
    title: "Friday Night Finals",
    channelName: "speedrunpro",
    status: "downloading",
    progress: {
      percent: 42,
      transferredBytes: 42 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
      bytesPerSecond: 2 * 1024 * 1024,
    },
    destinationPath: "D:\\Videos\\Friday Night Finals.mp4",
    thumbnailUrl: "https://static-cdn.jtvnw.net/finals.jpg",
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:01:00.000Z",
    ...overrides,
  };
}

let downloads: ReturnType<typeof installElectronAPIMock>["downloads"];

beforeEach(() => {
  const api = installElectronAPIMock();
  downloads = api.downloads;
  downloads.getQueue = vi.fn(async () => ({ jobs: [] }));
  downloads.onQueueChanged = vi.fn(() => vi.fn());
});

// Guards: persisted download jobs replace the old placeholder rows after the main-process queue loads
// Guards: live queue updates replace the visible jobs and release the IPC listener on unmount
// Guards: a newer queue push cannot be overwritten by an older initial IPC snapshot
// Guards: an empty persisted queue has an explicit first-download state instead of a blank page
// Guards: queue load failures remain distinct from empty state and can be retried in place
// Guards: only queued or downloading jobs expose the engine-backed cancel control
// Guards: completed files expose only the main-process file and list actions supported by the preload contract
// Guards: interrupted paused and waiting jobs can be removed without advertising unsupported resume or file actions
// Guards: persisted waiting and failure detail remains visible instead of collapsing to a generic status
describe("DownloadsPage", () => {
  it("loads and renders real queue jobs with their status and progress", async () => {
    vi.mocked(downloads.getQueue).mockResolvedValue({ jobs: [downloadJob()] });

    renderWithProviders(<DownloadsPage />);

    expect(screen.getByText("Loading downloads...")).toBeInTheDocument();
    expect(await screen.findByText("Friday Night Finals")).toBeInTheDocument();
    expect(screen.getByText("Downloading")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.queryByText("Epic Win Moment #32")).not.toBeInTheDocument();
  });

  it("renders queue pushes and unsubscribes when the page unmounts", async () => {
    let pushQueue: ((snapshot: { jobs: DownloadJob[] }) => void) | undefined;
    const unsubscribe = vi.fn();
    vi.mocked(downloads.onQueueChanged).mockImplementation((callback: typeof pushQueue) => {
      pushQueue = callback;
      return unsubscribe;
    });

    const view = renderWithProviders(<DownloadsPage />);
    await screen.findByText("No downloads yet");

    act(() => {
      pushQueue?.({
        jobs: [downloadJob({ id: "clip-2", kind: "clip", title: "Last-second save" })],
      });
    });

    expect(screen.getByText("Last-second save")).toBeInTheDocument();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps a queue push that arrives before the initial snapshot", async () => {
    let pushQueue: ((snapshot: { jobs: DownloadJob[] }) => void) | undefined;
    let resolveInitial: ((snapshot: { jobs: DownloadJob[] }) => void) | undefined;
    vi.mocked(downloads.onQueueChanged).mockImplementation((callback: typeof pushQueue) => {
      pushQueue = callback;
      return vi.fn();
    });
    vi.mocked(downloads.getQueue).mockReturnValue(
      new Promise((resolve) => {
        resolveInitial = resolve;
      })
    );

    renderWithProviders(<DownloadsPage />);
    act(() => {
      pushQueue?.({ jobs: [downloadJob({ title: "Newest queue state" })] });
    });
    expect(screen.getByText("Newest queue state")).toBeInTheDocument();

    await act(async () => {
      resolveInitial?.({ jobs: [] });
    });
    expect(screen.getByText("Newest queue state")).toBeInTheDocument();
  });

  it("renders an explicit empty state", async () => {
    renderWithProviders(<DownloadsPage />);

    expect(await screen.findByText("No downloads yet")).toBeInTheDocument();
    expect(screen.getByText(/Download a playable Clip or Video/)).toBeInTheDocument();
  });

  it("renders a retryable error state when the queue cannot load", async () => {
    vi.mocked(downloads.getQueue)
      .mockRejectedValueOnce(new Error("IPC unavailable"))
      .mockResolvedValueOnce({ jobs: [] });

    renderWithProviders(<DownloadsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load downloads.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No downloads yet")).toBeInTheDocument();
    expect(downloads.getQueue).toHaveBeenCalledTimes(2);
  });

  it("cancels active work without presenting unsupported lifecycle controls", async () => {
    vi.mocked(downloads.getQueue).mockResolvedValue({
      jobs: [downloadJob(), downloadJob({ id: "paused-1", title: "Paused VOD", status: "paused" })],
    });
    downloads.cancel = vi.fn(async () => ({ success: true }));

    renderWithProviders(<DownloadsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel Friday Night Finals" }));
    expect(downloads.cancel).toHaveBeenCalledWith("video-1");
    expect(
      screen.queryByRole("button", { name: /^(Pause|Resume|Retry download)/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Paused VOD" })).not.toBeInTheDocument();
  });

  it("lets users remove non-active paused and waiting rows", async () => {
    vi.mocked(downloads.getQueue).mockResolvedValue({
      jobs: [
        downloadJob({ id: "paused-1", title: "Interrupted VOD", status: "paused" }),
        downloadJob({ id: "waiting-1", title: "Rate-limited clip", status: "waiting" }),
      ],
    });
    downloads.remove = vi.fn(async () => ({ success: true }));

    renderWithProviders(<DownloadsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Interrupted VOD from list" })
    );
    expect(downloads.remove).toHaveBeenCalledWith("paused-1");
    expect(
      screen.getByRole("button", { name: "Remove Rate-limited clip from list" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Interrupted VOD" })).not.toBeInTheDocument();
  });

  it("opens, reveals, and removes a completed download", async () => {
    vi.mocked(downloads.getQueue).mockResolvedValue({
      jobs: [
        downloadJob({
          status: "completed",
          progress: { percent: 100, transferredBytes: 1, totalBytes: 1 },
        }),
      ],
    });
    downloads.openFile = vi.fn(async () => ({ success: true }));
    downloads.showInFolder = vi.fn(async () => ({ success: true }));
    downloads.remove = vi.fn(async () => ({ success: true }));

    renderWithProviders(<DownloadsPage />);

    for (const [label, method] of [
      ["Open Friday Night Finals", "openFile"],
      ["Show Friday Night Finals in folder", "showInFolder"],
      ["Remove Friday Night Finals from list", "remove"],
    ] as const) {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      expect(downloads[method]).toHaveBeenCalledWith("video-1");
    }

    expect(
      screen.getByRole("button", { name: "Delete Friday Night Finals from disk" })
    ).toBeInTheDocument();
  });

  it("renders provider waiting detail and terminal failure errors", async () => {
    vi.mocked(downloads.getQueue).mockResolvedValue({
      jobs: [
        downloadJob({ id: "waiting-1", status: "waiting", statusMessage: "Retrying at 12:30 PM" }),
        downloadJob({
          id: "failed-1",
          title: "Broken clip",
          status: "failed",
          error: "Disk is full",
        }),
      ],
    });

    renderWithProviders(<DownloadsPage />);

    expect(await screen.findByText("Retrying at 12:30 PM")).toBeInTheDocument();
    expect(screen.getByText("Disk is full")).toBeInTheDocument();
  });
});
