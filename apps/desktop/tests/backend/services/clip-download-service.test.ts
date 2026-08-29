import { describe, expect, it, vi } from "vitest";

import {
  createClipDownloadService,
  DownloadCancelledError,
} from "@backend/services/clip-download-service";
import { createDownloadQueueService } from "@backend/services/download-queue-service";
import type { DownloadQueueSnapshot } from "@shared/download-types";

function createStorage(seed: DownloadQueueSnapshot = { jobs: [] }) {
  let value = seed;
  return {
    getDownloadQueue: vi.fn(() => value),
    saveDownloadQueue: vi.fn((next: DownloadQueueSnapshot) => {
      value = next;
    }),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for background clip state");
}

// Guards: clip requests acknowledge persisted queue insertion without awaiting the background transfer.
// Guards: clip media is refreshed after user prompts immediately before background transfer starts.
// Guards: cancellation during signed-URL refresh cannot recursively restart a clip transfer.
// Guards: cancellation during the initial background refresh prevents the first transfer from starting.
describe("clip download service", () => {
  it("resolves a playable clip, asks for quality and save path, then completes with progress", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const downloadFile = vi.fn(async ({ onProgress }) => {
      onProgress({ percent: 50, transferredBytes: 50, totalBytes: 100 });
      onProgress({ percent: 100, transferredBytes: 100, totalBytes: 100 });
    });
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/source.mp4",
        format: "mp4",
        qualities: [
          { quality: "1080p", url: "https://cdn.example/source.mp4" },
          { quality: "720p", url: "https://cdn.example/720.mp4" },
        ],
      })),
      chooseQuality: vi.fn(async (qualities) => qualities[1]),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile,
    });

    const result = await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "completed");

    expect(result.success).toBe(true);
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://cdn.example/720.mp4",
        destinationPath: "D:\\Videos\\fpshero-Ace.mp4",
      })
    );
    expect(queue.getQueue().jobs[0]).toMatchObject({
      id: "clip-job-1",
      status: "completed",
      progress: { percent: 100, transferredBytes: 100, totalBytes: 100 },
      qualityLabel: "720p",
    });
  });

  it("cancels an active clip download and marks the job cancelled", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/source.mp4",
        format: "mp4",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile: vi.fn(
        ({ signal }) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DownloadCancelledError()), {
              once: true,
            });
          })
      ),
    });

    const promise = service.downloadClip({
      platform: "kick",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
      clipUrl: "https://cdn.example/source.mp4",
    });
    let acknowledged = false;
    void promise.then(() => {
      acknowledged = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledged).toBe(true);
    expect(service.cancel("clip-job-1")).toBe(true);

    const result = await promise;
    expect(result).toEqual({ success: true, jobId: "clip-job-1" });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "cancelled");
    expect(queue.getQueue().jobs[0].status).toBe("cancelled");
  });

  it("downloads Kick HLS clips through ffmpeg", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const downloadHls = vi.fn(async ({ onProgress }) => {
      onProgress({ percent: 50, transferredSeconds: 15, totalSeconds: 30, outputBytes: 512 });
      return {
        outputPath: "D:\\Videos\\fpshero-Ace.mp4",
        format: "mp4" as const,
        outputBytes: 1024,
      };
    });
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/source.m3u8",
        format: "hls",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile: vi.fn(),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const result = await service.downloadClip({
      platform: "kick",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
      clipUrl: "https://cdn.example/source.m3u8",
      durationSeconds: 30,
      thumbnailUrl: "https://cdn.example/thumb.jpg",
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "completed");

    expect(result.success).toBe(true);
    expect(downloadHls).toHaveBeenCalledWith(
      expect.objectContaining({
        ffmpegPath: "ffmpeg",
        inputUrl: "https://cdn.example/source.m3u8",
        destinationPath: "D:\\Videos\\fpshero-Ace.mp4",
        durationSeconds: 30,
      })
    );
    expect(queue.getQueue().jobs[0]).toMatchObject({
      status: "completed",
      outputFormat: "mp4",
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      progress: { percent: 100, transferredBytes: 1024, totalBytes: 1024 },
    });
  });

  it("marks disk errors as failed and preserves the retryable clip request", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/source.mp4",
        format: "mp4",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    const result = await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });

    expect(result).toEqual({ success: true, jobId: "clip-job-1" });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "failed");
    expect(queue.getQueue().jobs[0]).toMatchObject({
      status: "failed",
      error: "disk full",
      partial: true,
      retryable: true,
      source: { clip: { clipId: "ace" } },
    });
  });

  it("retries a failed clip job through the stored clip request", async () => {
    const storage = createStorage();
    const queue = createDownloadQueueService({
      storage,
      createId: () => "clip-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const downloadFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/source.mp4",
        format: "mp4",
        qualities: [{ quality: "1080p", url: "https://cdn.example/source.mp4" }],
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi
        .fn()
        .mockReturnValueOnce("D:\\Videos\\fpshero-Ace.mp4")
        .mockReturnValueOnce("D:\\Videos\\fpshero-Ace (1).mp4"),
      downloadFile,
    });

    await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "failed");
    const result = await service.retryClip("clip-job-1");

    expect(result.success).toBe(true);
    expect(downloadFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ destinationPath: "D:\\Videos\\fpshero-Ace (1).mp4" })
    );
    expect(queue.getQueue().jobs[0]).toMatchObject({
      status: "completed",
      destinationPath: "D:\\Videos\\fpshero-Ace (1).mp4",
    });
  });

  it("refreshes expired signed clip URLs before failing the job", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
    });
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://cdn.example/expired.mp4",
        format: "mp4",
        qualities: [{ quality: "1080p", url: "https://cdn.example/expired.mp4" }],
      })
      .mockResolvedValueOnce({
        url: "https://cdn.example/fresh.mp4",
        format: "mp4",
        qualities: [{ quality: "1080p", url: "https://cdn.example/fresh.mp4" }],
      })
      .mockResolvedValueOnce({
        url: "https://cdn.example/fresher.mp4",
        format: "mp4",
        qualities: [{ quality: "1080p", url: "https://cdn.example/fresher.mp4" }],
      });
    const downloadFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Download request failed with status 403"))
      .mockResolvedValueOnce(undefined);
    const service = createClipDownloadService({
      queue,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile,
    });

    const result = await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "completed");

    expect(result.success).toBe(true);
    expect(resolvePlayback).toHaveBeenCalledTimes(3);
    expect(downloadFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "https://cdn.example/fresher.mp4" })
    );
    expect(queue.getQueue().jobs[0].status).toBe("completed");
  });

  it("does not restart a clip when cancelled during expired signed URL refresh", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
    });
    let finishRefresh = (_playback: {
      url: string;
      format: string;
      qualities: Array<{ quality: string; url: string }>;
    }) => {};
    const expiredPlayback = {
      url: "https://cdn.example/expired.mp4",
      format: "mp4",
      qualities: [{ quality: "1080p", url: "https://cdn.example/expired.mp4" }],
    };
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce(expiredPlayback)
      .mockResolvedValueOnce(expiredPlayback)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          })
      );
    const downloadFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Download request failed with status 403"))
      .mockResolvedValueOnce(undefined);
    const service = createClipDownloadService({
      queue,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile,
    });

    await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });
    await waitFor(() => resolvePlayback.mock.calls.length === 3);

    expect(service.cancel("clip-job-1")).toBe(true);
    finishRefresh({
      url: "https://cdn.example/fresh.mp4",
      format: "mp4",
      qualities: [{ quality: "1080p", url: "https://cdn.example/fresh.mp4" }],
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status !== "downloading");

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(queue.getQueue().jobs[0].status).toBe("cancelled");
    expect(service.cancel("clip-job-1")).toBe(false);
  });

  it("does not start a clip cancelled during its initial background refresh", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "clip-job-1",
    });
    let finishRefresh = (_playback: { url: string; format: string }) => {};
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({ url: "https://cdn.example/initial.mp4", format: "mp4" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          })
      );
    const downloadFile = vi.fn(async () => undefined);
    const service = createClipDownloadService({
      queue,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\fpshero-Ace.mp4"),
      getAvailablePath: vi.fn((path) => path),
      downloadFile,
    });

    await service.downloadClip({
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    });
    await waitFor(() => resolvePlayback.mock.calls.length === 2);

    expect(service.cancel("clip-job-1")).toBe(false);
    queue.cancel("clip-job-1");
    finishRefresh({ url: "https://cdn.example/fresh.mp4", format: "mp4" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(downloadFile).not.toHaveBeenCalled();
    expect(queue.getQueue().jobs[0].status).toBe("cancelled");
  });

  it("removes a failed clip job when the source is gone on retry", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage({
        jobs: [
          {
            id: "clip-job-1",
            kind: "clip",
            platform: "twitch",
            sourceId: "ace",
            title: "Ace",
            channelName: "fpshero",
            status: "failed",
            progress: { percent: 25, transferredBytes: 25, totalBytes: 100 },
            destinationPath: "D:\\Videos\\fpshero-Ace.mp4",
            createdAt: "2026-07-07T12:00:00.000Z",
            updatedAt: "2026-07-07T12:01:00.000Z",
            source: { clip: { clipId: "ace" } },
          },
        ],
      }),
    });
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => {
        throw new Error("source removed");
      }),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: vi.fn((path) => path),
      downloadFile: vi.fn(),
    });

    const result = await service.retryClip("clip-job-1");

    expect(result).toEqual({ success: false, jobId: "clip-job-1", error: "Source removed" });
    expect(queue.getQueue().jobs).toEqual([]);
  });

  it("moves a throttled retry into waiting with the next retry time", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage({
        jobs: [
          {
            id: "clip-job-1",
            kind: "clip",
            platform: "kick",
            sourceId: "ace",
            title: "Ace",
            channelName: "fpshero",
            status: "failed",
            progress: { percent: 25, transferredBytes: 25, totalBytes: 100 },
            destinationPath: "D:\\Videos\\fpshero-Ace.mp4",
            createdAt: "2026-07-07T12:00:00.000Z",
            updatedAt: "2026-07-07T12:01:00.000Z",
            source: { clip: { clipId: "ace" } },
          },
        ],
      }),
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const rateLimitError = new Error("rate limited") as Error & { retryAfterMs: number };
    rateLimitError.retryAfterMs = 60_000;
    const service = createClipDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => {
        throw rateLimitError;
      }),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: vi.fn((path) => path),
      downloadFile: vi.fn(),
      now: () => "2026-07-07T12:00:00.000Z",
    });

    const result = await service.retryClip("clip-job-1");

    expect(result).toEqual({ success: false, jobId: "clip-job-1", error: "Waiting for platform" });
    expect(queue.getQueue().jobs[0]).toMatchObject({
      status: "waiting",
      retryable: true,
      statusMessage: "Waiting for platform",
      nextRetryAt: "2026-07-07T12:01:00.000Z",
    });
  });
});
