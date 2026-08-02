import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import { type BrowserWindow, dialog, shell } from "electron";

import type { DownloadJob } from "@/shared/download-types";
import type { DownloadQueueService } from "./download-queue-service";

export interface DownloadFileActionResult {
  success: boolean;
  error?: string;
  cancelled?: boolean;
}

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

export function createDownloadFileActionsService({
  queue,
  exists,
  showItemInFolder,
  openPath,
  confirmDelete,
  deleteFile,
}: {
  queue: DownloadQueueService;
  exists: (path: string) => boolean;
  showItemInFolder: (path: string) => void;
  openPath: (path: string) => Promise<string>;
  confirmDelete: (job: DownloadJob) => Promise<boolean>;
  deleteFile: (path: string) => Promise<void>;
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
      if (!exists(job.destinationPath)) return missingFile();
      if (!(await confirmDelete(job))) return { success: false, cancelled: true };
      await deleteFile(job.destinationPath);
      queue.remove(jobId);
      return { success: true };
    },
  };
}

export function getDefaultDownloadFileActionsService(
  mainWindow: BrowserWindow,
  queue: DownloadQueueService
): DownloadFileActionsService {
  return createDownloadFileActionsService({
    queue,
    exists: existsSync,
    showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
    openPath: (filePath) => shell.openPath(filePath),
    confirmDelete: async (job) => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Delete downloaded file?",
        message: `Delete "${job.title}" from disk?`,
        detail:
          "This removes the file from your computer. Removing a row from Downloads is separate.",
        buttons: ["Cancel", "Delete File"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1;
    },
    deleteFile: (filePath) => unlink(filePath),
  });
}
