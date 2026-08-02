import { describe, expect, it, vi } from "vitest";

import { createDownloadQueueService } from "@/backend/services/download-queue-service";
import type { DownloadQueueSnapshot } from "@/shared/download-types";

function createStorage(seed: DownloadQueueSnapshot) {
  let value = seed;
  return {
    getDownloadQueue: vi.fn(() => value),
    saveDownloadQueue: vi.fn((next: DownloadQueueSnapshot) => {
      value = next;
    }),
  };
}

describe("download queue service", () => {
  it("filters legacy Stream Recording rows without touching their files", () => {
    const legacy = {
      id: "legacy-recording",
      kind: "stream-recording",
      platform: "twitch",
      sourceId: "ninja",
      title: "Old recording",
      channelName: "ninja",
      status: "recording",
      progress: { percent: null, transferredBytes: 10, totalBytes: null },
      destinationPath: "D:/Videos/old-recording.mp4",
      createdAt: "2026-07-07T10:00:00.000Z",
      updatedAt: "2026-07-07T10:00:10.000Z",
    };
    const storage = createStorage({ jobs: [legacy] } as never);

    const service = createDownloadQueueService({ storage });

    expect(service.getQueue()).toEqual({ jobs: [] });
    expect(storage.saveDownloadQueue).toHaveBeenCalledWith({ jobs: [] });
  });

  it("rejects new Stream Recording rows at the Downloads boundary", () => {
    const storage = createStorage({ jobs: [] });
    const service = createDownloadQueueService({ storage });

    expect(() =>
      service.enqueue({
        kind: "stream-recording",
        platform: "twitch",
        sourceId: "ninja",
        title: "Recording",
        channelName: "ninja",
        destinationPath: "D:/Videos/recording.mp4",
      } as never)
    ).toThrow("Stream Recording state does not belong in Downloads");
    expect(service.getQueue()).toEqual({ jobs: [] });
  });

  it("hydrates active jobs as paused and persists the normalized queue", () => {
    const storage = createStorage({
      jobs: [
        {
          id: "video-1",
          kind: "video",
          platform: "twitch",
          sourceId: "123",
          title: "Finals Night",
          channelName: "speedrunpro",
          status: "downloading",
          progress: { percent: 42, transferredBytes: 420, totalBytes: 1000 },
          destinationPath: "D:/Videos/speedrunpro-Finals Night.mp4",
          createdAt: "2026-07-07T10:00:00.000Z",
          updatedAt: "2026-07-07T10:05:00.000Z",
        },
        {
          id: "clip-1",
          kind: "clip",
          platform: "kick",
          sourceId: "clip-a",
          title: "Ace clutch",
          channelName: "fpshero",
          status: "queued",
          progress: { percent: 0, transferredBytes: 0, totalBytes: null },
          destinationPath: "D:/Videos/fpshero-Ace clutch.mp4",
          createdAt: "2026-07-07T10:01:00.000Z",
          updatedAt: "2026-07-07T10:01:00.000Z",
        },
      ],
    });

    const service = createDownloadQueueService({ storage });

    expect(service.getQueue().jobs.map((job) => [job.id, job.status])).toEqual([
      ["video-1", "paused"],
      ["clip-1", "queued"],
    ]);
    expect(storage.saveDownloadQueue).toHaveBeenCalledWith(service.getQueue());
  });

  it("enqueues a placeholder job with default progress and persists it", () => {
    const storage = createStorage({ jobs: [] });
    const service = createDownloadQueueService({
      storage,
      createId: () => "job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });

    const job = service.enqueue({
      kind: "clip",
      platform: "twitch",
      sourceId: "clip-123",
      title: "Ace clutch",
      channelName: "fpshero",
      destinationPath: "D:/Videos/fpshero-Ace clutch.mp4",
    });

    expect(job).toMatchObject({
      id: "job-1",
      kind: "clip",
      status: "queued",
      progress: { percent: 0, transferredBytes: 0, totalBytes: null },
      createdAt: "2026-07-07T12:00:00.000Z",
      updatedAt: "2026-07-07T12:00:00.000Z",
    });
    expect(service.getQueue().jobs).toEqual([job]);
    expect(storage.saveDownloadQueue).toHaveBeenLastCalledWith({ jobs: [job] });
  });

  it("pauses a queued job and persists the status change", () => {
    const storage = createStorage({ jobs: [] });
    const service = createDownloadQueueService({
      storage,
      createId: () => "job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    service.enqueue({
      kind: "clip",
      platform: "twitch",
      sourceId: "clip-123",
      title: "Ace clutch",
      channelName: "fpshero",
      destinationPath: "D:/Videos/fpshero-Ace clutch.mp4",
    });

    const paused = service.pause("job-1", "2026-07-07T12:01:00.000Z");

    expect(paused?.status).toBe("paused");
    expect(paused?.updatedAt).toBe("2026-07-07T12:01:00.000Z");
    expect(service.getQueue().jobs[0]).toBe(paused);
    expect(storage.saveDownloadQueue).toHaveBeenLastCalledWith(service.getQueue());
  });

  it("resumes, cancels, retries, and removes jobs through persisted controls", () => {
    const storage = createStorage({
      jobs: [
        {
          id: "paused-1",
          kind: "video",
          platform: "twitch",
          sourceId: "v1",
          title: "Finals",
          channelName: "speedrunpro",
          status: "paused",
          progress: { percent: 10, transferredBytes: 100, totalBytes: 1000 },
          destinationPath: "D:/Videos/speedrunpro-Finals.mp4",
          createdAt: "2026-07-07T12:00:00.000Z",
          updatedAt: "2026-07-07T12:00:00.000Z",
        },
        {
          id: "failed-1",
          kind: "clip",
          platform: "kick",
          sourceId: "c1",
          title: "Ace",
          channelName: "fpshero",
          status: "failed",
          progress: { percent: 50, transferredBytes: 50, totalBytes: 100 },
          destinationPath: "D:/Videos/fpshero-Ace.mp4",
          createdAt: "2026-07-07T12:00:00.000Z",
          updatedAt: "2026-07-07T12:00:00.000Z",
          error: "disk full",
        },
      ],
    });
    const service = createDownloadQueueService({ storage });

    expect(service.resume("paused-1", "2026-07-07T12:01:00.000Z")?.status).toBe("queued");
    expect(service.cancel("paused-1", "2026-07-07T12:02:00.000Z")?.status).toBe("cancelled");
    const retried = service.retry("failed-1", "2026-07-07T12:03:00.000Z");
    expect(retried?.status).toBe("queued");
    expect(retried?.error).toBeNull();

    expect(service.remove("paused-1")).toBe(true);
    expect(service.getQueue().jobs.map((job) => job.id)).toEqual(["failed-1"]);
    expect(storage.saveDownloadQueue).toHaveBeenLastCalledWith(service.getQueue());
  });

  it("notifies subscribers when job progress changes", () => {
    const storage = createStorage({ jobs: [] });
    const service = createDownloadQueueService({
      storage,
      createId: () => "job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    service.enqueue({
      kind: "video",
      platform: "twitch",
      sourceId: "v1",
      title: "Finals",
      channelName: "speedrunpro",
      destinationPath: "D:/Videos/speedrunpro-Finals.mp4",
    });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.updateProgress(
      "job-1",
      { percent: 25, transferredBytes: 250, totalBytes: 1000 },
      "2026-07-07T12:04:00.000Z"
    );

    expect(listener).toHaveBeenCalledWith(service.getQueue());
    expect(service.getQueue().jobs[0].progress.percent).toBe(25);
    unsubscribe();
    service.updateProgress("job-1", { percent: 30, transferredBytes: 300, totalBytes: 1000 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("derives transfer speed from byte progress deltas", () => {
    const storage = createStorage({ jobs: [] });
    const service = createDownloadQueueService({
      storage,
      createId: () => "job-1",
      now: () => "2026-07-07T12:00:00.000Z",
    });
    service.enqueue({
      kind: "video",
      platform: "twitch",
      sourceId: "v1",
      title: "Finals",
      channelName: "speedrunpro",
      destinationPath: "D:/Videos/speedrunpro-Finals.mp4",
    });

    service.updateProgress(
      "job-1",
      { percent: 50, transferredBytes: 10 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 },
      "2026-07-07T12:00:02.000Z"
    );

    expect(service.getQueue().jobs[0].progress.bytesPerSecond).toBe(5 * 1024 * 1024);
  });
});
