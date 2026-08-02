import { describe, expect, it, vi } from "vitest";

import { createDownloadFileActionsService } from "@/backend/services/download-file-actions-service";
import { createDownloadQueueService } from "@/backend/services/download-queue-service";
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

function createQueue() {
  return createDownloadQueueService({
    storage: createStorage({
      jobs: [
        {
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
        },
      ],
    }),
  });
}

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
      confirmDelete: vi.fn(),
      deleteFile: vi.fn(),
    });

    await expect(service.showInFolder("job-1")).resolves.toEqual({ success: true });
    await expect(service.openFile("job-1")).resolves.toEqual({ success: true });

    expect(showItemInFolder).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(openPath).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(queue.getQueue().jobs).toHaveLength(1);
  });

  it("removes a row without deleting the file", async () => {
    const queue = createQueue();
    const deleteFile = vi.fn();
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      confirmDelete: vi.fn(),
      deleteFile,
    });

    await expect(service.removeFromList("job-1")).resolves.toEqual({ success: true });

    expect(deleteFile).not.toHaveBeenCalled();
    expect(queue.getQueue().jobs).toEqual([]);
  });

  it("deletes a completed file only after confirmation and then removes the row", async () => {
    const queue = createQueue();
    const deleteFile = vi.fn(async () => {});
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => true),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      confirmDelete: vi.fn(async () => true),
      deleteFile,
    });

    await expect(service.deleteFile("job-1")).resolves.toEqual({ success: true });

    expect(deleteFile).toHaveBeenCalledWith("D:\\Videos\\speedrunpro-Finals.mp4");
    expect(queue.getQueue().jobs).toEqual([]);
  });

  it("keeps the row when delete is cancelled or the file is missing", async () => {
    const queue = createQueue();
    const service = createDownloadFileActionsService({
      queue,
      exists: vi.fn(() => false),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
      confirmDelete: vi.fn(async () => false),
      deleteFile: vi.fn(),
    });

    await expect(service.deleteFile("job-1")).resolves.toEqual({
      success: false,
      error: "File not found",
    });
    expect(queue.getQueue().jobs).toHaveLength(1);
  });
});
