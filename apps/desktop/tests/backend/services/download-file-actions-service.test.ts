import { describe, expect, it, vi } from "vitest";

import { createDownloadFileActionsService } from "@backend/services/download-file-actions-service";
import { createDownloadQueueService } from "@backend/services/download-queue-service";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";

function createStorage(seed: DownloadQueueSnapshot = { jobs: [] }) {
  let value = seed;
  return {
    getDownloadQueue: vi.fn(() => value),
    saveDownloadQueue: vi.fn((next: DownloadQueueSnapshot) => {
      value = next;
    }),
  };
}

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    kind: "video",
    platform: "twitch",
    sourceId: "vod-1",
    title: "Finals",
    channelName: "speedrunpro",
    status: "completed",
    progress: { percent: 100, transferredBytes: 100, totalBytes: 100 },
    destinationPath: "D:\\Videos\\speedrunpro-Finals.mp4",
    createdAt: "2026-07-07T12:00:00.000Z",
    updatedAt: "2026-07-07T12:01:00.000Z",
    ...overrides,
  };
}

function createQueue(jobs: DownloadJob[] = [downloadJob()]) {
  return createDownloadQueueService({
    storage: createStorage({ jobs }),
  });
}

// Guards: showing, opening, or removing a list row does not unlink the main-owned file path
// Guards: only completed and inactive partial downloads can be unlinked from disk
// Guards: a failed unlink leaves its queue row in place for a safe retry
// Guards: queue removal happens only after the filesystem unlink resolves
describe("download file actions service", () => {
  it("reveals and opens an existing completed file without removing the queue row", async () => {
    const queue = createQueue();
    const showItemInFolder = vi.fn();
    const openPath = vi.fn(async () => "");
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder,
      openPath,
      unlinkFile: vi.fn(),
    });

    await expect(service.showInFolder("job-1")).resolves.toEqual({ success: true });
    await expect(service.openFile("job-1")).resolves.toEqual({ success: true });

    expect(showItemInFolder).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(openPath).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(queue.getQueue().jobs).toHaveLength(1);
  });

  it("removes a row without deleting the file", async () => {
    const queue = createQueue();
    const unlinkFile = vi.fn();
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile,
    });

    await expect(service.removeFromList("job-1")).resolves.toEqual({ success: true });

    expect(unlinkFile).not.toHaveBeenCalled();
    expect(queue.getQueue().jobs).toEqual([]);
  });

  it("deletes a completed file and then removes its row", async () => {
    const queue = createQueue();
    const unlinkFile = vi.fn(async () => {});
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile,
    });

    await expect(service.deleteFile("job-1")).resolves.toEqual({ success: true });

    expect(unlinkFile).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(queue.getQueue().jobs).toEqual([]);
  });

  it("deletes an inactive partial file but rejects active partial downloads", async () => {
    const partialQueue = createQueue([downloadJob({ status: "failed", partial: true })]);
    const unlinkFile = vi.fn(async () => {});
    const partialService = createDownloadFileActionsService({
      queue: partialQueue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile,
    });

    await expect(partialService.deleteFile("job-1")).resolves.toEqual({ success: true });
    expect(unlinkFile).toHaveBeenCalledOnce();

    const activeQueue = createQueue([downloadJob({ status: "queued", partial: true })]);
    const activeService = createDownloadFileActionsService({
      queue: activeQueue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile: vi.fn(),
    });
    await expect(activeService.deleteFile("job-1")).resolves.toEqual({
      success: false,
      error: "This download cannot be deleted from disk yet.",
    });
    activeQueue.start("job-1");
    await expect(activeService.deleteFile("job-1")).resolves.toEqual({
      success: false,
      error: "This download cannot be deleted from disk yet.",
    });
  });

  it("keeps the row when the file is missing or unlink fails", async () => {
    const queue = createQueue();
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => false),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile: vi.fn(),
    });

    await expect(service.deleteFile("job-1")).resolves.toEqual({
      success: false,
      error: "File not found",
    });
    expect(queue.getQueue().jobs).toHaveLength(1);

    const unlinkFailure = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile: vi.fn(async () => {
        throw new Error("Access denied");
      }),
    });
    await expect(unlinkFailure.deleteFile("job-1")).resolves.toEqual({
      success: false,
      error: "The file could not be deleted.",
    });
    expect(queue.getQueue().jobs).toHaveLength(1);
  });

  it("does not remove the row before unlink succeeds", async () => {
    const queue = createQueue();
    let resolveUnlink: (() => void) | undefined;
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      unlinkFile: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveUnlink = resolve;
          })
      ),
    });

    const deleting = service.deleteFile("job-1");
    expect(queue.getQueue().jobs).toHaveLength(1);
    resolveUnlink?.();
    await expect(deleting).resolves.toEqual({ success: true });
    expect(queue.getQueue().jobs).toEqual([]);
  });
});
