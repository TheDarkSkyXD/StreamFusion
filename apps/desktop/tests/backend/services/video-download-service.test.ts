import { describe, expect, it, vi } from "vitest";

import { createDownloadQueueService } from "@/backend/services/download-queue-service";
import { createVideoDownloadService } from "@/backend/services/video-download-service";
import type { DownloadQueueSnapshot } from "@/shared/download-types";

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
  throw new Error("Timed out waiting for background download state");
}

// Guards: queued cancellation prevents source resolution and ffmpeg startup when the job reaches its turn.
// Guards: source URLs are refreshed inside the serialized run immediately before ffmpeg starts.
// Guards: download requests acknowledge queue insertion without awaiting the background transfer.
// Guards: dismissing the save dialog is a normal cancellation and never creates a queue job.
describe("video download service", () => {
  it("refreshes a playable HLS URL at job start and completes through ffmpeg", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "video-job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    const downloadHls = vi.fn(async ({ onProgress }) => {
      onProgress({ percent: 25, transferredSeconds: 15, totalSeconds: 60 });
      return { outputPath: "D:\\Videos\\speedrunpro-Finals.mp4", format: "mp4" as const };
    });
    const service = createVideoDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/refreshed.m3u8",
        format: "hls",
        durationSeconds: 60,
      })),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\speedrunpro-Finals.mp4"),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const result = await service.downloadVideo({
      platform: "twitch",
      videoId: "123",
      title: "Finals",
      channelName: "speedrunpro",
    });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "completed");

    expect(result.success).toBe(true);
    expect(downloadHls).toHaveBeenCalledWith(
      expect.objectContaining({
        ffmpegPath: "ffmpeg",
        inputUrl: "https://cdn.example/refreshed.m3u8",
      })
    );
    expect(queue.getQueue().jobs[0]).toMatchObject({
      id: "video-job-1",
      status: "completed",
      outputFormat: "mp4",
    });
  });

  it("persists a background failure when playable media is unavailable at job start", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "video-job-1",
    });
    const service = createVideoDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => {
        throw new Error("VOD not found");
      }),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\missing.mp4"),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls: vi.fn(),
    });

    const result = await service.downloadVideo({
      platform: "kick",
      videoId: "missing",
      title: "Removed stream",
      channelName: "speedrunpro",
    });

    expect(result).toEqual({ success: true, jobId: "video-job-1" });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "failed");
    expect(queue.getQueue().jobs[0]).toMatchObject({ status: "failed", error: "VOD not found" });
  });

  it("treats a dismissed save dialog as cancellation", async () => {
    const queue = createDownloadQueueService({ storage: createStorage() });
    const resolvePlayback = vi.fn();
    const downloadHls = vi.fn();
    const service = createVideoDownloadService({
      queue,
      resolvePlayback,
      chooseSavePath: vi.fn(async () => null),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const result = await service.downloadVideo({
      platform: "twitch",
      videoId: "123",
      title: "Finals",
      channelName: "speedrunpro",
    });

    expect(result).toEqual({ success: false, cancelled: true, error: "Save cancelled" });
    expect(queue.getQueue().jobs).toEqual([]);
    expect(resolvePlayback).not.toHaveBeenCalled();
    expect(downloadHls).not.toHaveBeenCalled();
  });

  it("keeps a second video queued while one video ffmpeg job is active", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: vi.fn().mockReturnValueOnce("video-job-1").mockReturnValueOnce("video-job-2"),
      now: () => "2026-07-07T12:00:00.000Z",
    });
    let finishFirst = () => {};
    const downloadHls = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ outputPath: string; format: "mp4" }>((resolve) => {
            finishFirst = () => resolve({ outputPath: "D:\\Videos\\one.mp4", format: "mp4" });
          })
      )
      .mockResolvedValueOnce({ outputPath: "D:\\Videos\\two.mp4", format: "mp4" });
    const resolvePlayback = vi.fn(async (request) => ({
      url: `https://cdn.example/${request.videoId}.m3u8`,
      format: "hls",
    }));
    const service = createVideoDownloadService({
      queue,
      resolvePlayback,
      chooseSavePath: vi.fn(async (request) => `D:\\Videos\\${request.videoId}.mp4`),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const first = service.downloadVideo({
      platform: "twitch",
      videoId: "one",
      title: "One",
      channelName: "speedrunpro",
    });
    const second = service.downloadVideo({
      platform: "twitch",
      videoId: "two",
      title: "Two",
      channelName: "speedrunpro",
    });
    let firstAcknowledged = false;
    void first.then(() => {
      firstAcknowledged = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstAcknowledged).toBe(true);
    expect(resolvePlayback).toHaveBeenCalledTimes(1);
    expect(queue.getQueue().jobs.map((job) => [job.id, job.status])).toEqual([
      ["video-job-1", "downloading"],
      ["video-job-2", "queued"],
    ]);

    finishFirst();
    await first;
    await second;
    await waitFor(() => queue.getQueue().jobs[1]?.status === "completed");

    expect(queue.getQueue().jobs.map((job) => [job.id, job.status])).toEqual([
      ["video-job-1", "completed"],
      ["video-job-2", "completed"],
    ]);
  });

  it("aborts an active ffmpeg run and never overwrites cancellation with completion", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: () => "video-job-1",
    });
    const downloadHls = vi.fn(
      ({ signal }) =>
        new Promise<{ outputPath: string; format: "mp4" }>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ outputPath: "D:\\Videos\\cancelled.mp4", format: "mp4" }),
            { once: true }
          );
        })
    );
    const service = createVideoDownloadService({
      queue,
      resolvePlayback: vi.fn(async () => ({
        url: "https://usher.ttvnw.net/vod/123.m3u8",
        format: "hls",
      })),
      chooseSavePath: vi.fn(async () => "D:\\Videos\\cancelled.mp4"),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const downloading = service.downloadVideo({
      platform: "twitch",
      videoId: "123",
      title: "Finals",
      channelName: "speedrunpro",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.cancel("video-job-1")).toBe(true);
    await expect(downloading).resolves.toEqual({ success: true, jobId: "video-job-1" });
    await waitFor(() => queue.getQueue().jobs[0]?.status === "cancelled");
    expect(queue.getQueue().jobs[0].status).toBe("cancelled");
  });

  it("never resolves or starts a queued VOD cancelled before its turn", async () => {
    const queue = createDownloadQueueService({
      storage: createStorage(),
      createId: vi.fn().mockReturnValueOnce("video-job-1").mockReturnValueOnce("video-job-2"),
    });
    let finishFirst = () => {};
    const downloadHls = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ outputPath: string; format: "mp4" }>((resolve) => {
            finishFirst = () => resolve({ outputPath: "D:\\Videos\\one.mp4", format: "mp4" });
          })
      )
      .mockResolvedValue({ outputPath: "D:\\Videos\\two.mp4", format: "mp4" });
    const resolvePlayback = vi.fn(async (request) => ({
      url: `https://usher.ttvnw.net/vod/${request.videoId}.m3u8`,
      format: "hls",
    }));
    const service = createVideoDownloadService({
      queue,
      resolvePlayback,
      chooseSavePath: vi.fn(async (request) => `D:\\Videos\\${request.videoId}.mp4`),
      getAvailablePath: vi.fn((path) => path),
      resolveFfmpegPath: vi.fn(() => "ffmpeg"),
      downloadHls,
    });

    const first = service.downloadVideo({
      platform: "twitch",
      videoId: "one",
      title: "One",
      channelName: "speedrunpro",
    });
    const second = service.downloadVideo({
      platform: "twitch",
      videoId: "two",
      title: "Two",
      channelName: "speedrunpro",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.cancel("video-job-2")).toBe(false);
    queue.cancel("video-job-2");
    finishFirst();
    await first;
    await second;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolvePlayback).toHaveBeenCalledTimes(1);
    expect(downloadHls).toHaveBeenCalledTimes(1);
    expect(queue.getQueue().jobs[1].status).toBe("cancelled");
  });
});
