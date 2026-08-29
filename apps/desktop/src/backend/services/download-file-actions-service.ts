import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import { shell } from "electron";

import type { DownloadJob } from "@shared/download-types";
import type { DownloadQueueService } from "./download-queue-service";

export type DownloadFileActionResult = { success: true } | { success: false; error: string };

export interface DownloadFileActionsService {
  showInFolder(jobId: string): Promise<DownloadFileActionResult>;
  openFile(jobId: string): Promise<DownloadFileActionResult>;
  removeFromList(jobId: string): Promise<DownloadFileActionResult>;
  deleteFile(jobId: string): Promise<DownloadFileActionResult>;
}

function getJob(queue: DownloadQueueService, jobId: string): DownloadJob | null {
  return queue.getQueue().jobs.find((job) => job.id === jobId) ?? null;
}

function missingFile(): DownloadFileActionResult {
  return { success: false, error: "File not found" };
}

function canDeleteFile(job: DownloadJob): boolean {
  const isActive = job.status === "queued" || job.status === "downloading";
  return !isActive && (job.status === "completed" || job.partial === true);
}

export function createDownloadFileActionsService({
  queue,
  exists,
  showItemInFolder,
  openPath,
  unlinkFile,
}: {
  queue: DownloadQueueService;
  exists: (path: string) => boolean;
  showItemInFolder: (path: string) => void;
  openPath: (path: string) => Promise<string>;
  unlinkFile: (path: string) => Promise<void>;
}): DownloadFileActionsService {
  return {
    async showInFolder(jobId) {
      const job = getJob(queue, jobId);
      if (!job) return { success: false, error: "Download job not found" };
      if (!exists(job.destinationPath)) return missingFile();
      showItemInFolder(job.destinationPath);
      return { success: true };
    },
    async openFile(jobId) {
      const job = getJob(queue, jobId);
      if (!job) return { success: false, error: "Download job not found" };
      if (!exists(job.destinationPath)) return missingFile();
      const error = await openPath(job.destinationPath);
      return error ? { success: false, error } : { success: true };
    },
    async removeFromList(jobId) {
      return queue.remove(jobId)
        ? { success: true }
        : { success: false, error: "Download job not found" };
    },
    async deleteFile(jobId) {
      const job = getJob(queue, jobId);
      if (!job) return { success: false, error: "Download job not found" };
      if (!canDeleteFile(job)) {
        return { success: false, error: "This download cannot be deleted from disk yet." };
      }
      if (!exists(job.destinationPath)) return missingFile();
      try {
        await unlinkFile(job.destinationPath);
      } catch {
        return { success: false, error: "The file could not be deleted." };
      }
      queue.remove(jobId);
      return { success: true };
    },
  };
}

export function getDefaultDownloadFileActionsService(
  queue: DownloadQueueService
): DownloadFileActionsService {
  return createDownloadFileActionsService({
    queue,
    exists: existsSync,
    showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
    openPath: (filePath) => shell.openPath(filePath),
    unlinkFile: (filePath) => unlink(filePath),
  });
}
