import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import type { ClipDownloadRequest } from "@shared/download-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { getDefaultClipDownloadService } from "../../services/clip-download-default-service";
import { getDefaultDownloadFileActionsService } from "../../services/download-file-actions-service";
import { getDownloadQueueService } from "../../services/download-queue-service";
import { getDefaultVideoDownloadService } from "../../services/video-download-default-service";
import { isAllowedSender } from "../sender-origin";
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

const REJECTED = {
  success: false as const,
  error: "Rejected: caller is not the application renderer.",
};

function idFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function jobResult<T>(
  job: T | null
): { success: true; job: T } | { success: false; error: string } {
  if (!job) return { success: false, error: "Download job not found" };
  return { success: true, job };
}

export function registerDownloadHandlers(renderer: MainRendererPort): void {
  const service = getDownloadQueueService();
  const clipDownloads = getDefaultClipDownloadService(renderer, service);
  const videoDownloads = getDefaultVideoDownloadService(renderer, service);
  const fileActions = getDefaultDownloadFileActionsService(service);

  const registeredChannels: string[] = [];
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, listener);
    registeredChannels.push(channel);
  };

  try {
    handle(IPC_CHANNELS.DOWNLOADS_GET_QUEUE, (event) =>
      isAllowedSender(event) ? service.getQueue() : REJECTED
    );

    handle(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP, (event, payload: ClipDownloadRequest) => {
      if (!isAllowedSender(event)) return REJECTED;
      return clipDownloads.downloadClip(payload);
    });

    handle(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      return videoDownloads.downloadVideo(payload);
    });

    handle(IPC_CHANNELS.DOWNLOADS_PAUSE, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      if (!id) return { success: false, error: "id is required" };
      return jobResult(service.pause(id));
    });

    handle(IPC_CHANNELS.DOWNLOADS_RESUME, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      if (!id) return { success: false, error: "id is required" };
      return jobResult(service.resume(id));
    });

    handle(IPC_CHANNELS.DOWNLOADS_CANCEL, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      if (!id) return { success: false, error: "id is required" };
      return clipDownloads.cancel(id) || videoDownloads.cancel(id)
        ? { success: true }
        : jobResult(service.cancel(id));
    });

    handle(IPC_CHANNELS.DOWNLOADS_RETRY, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      if (!id) return { success: false, error: "id is required" };
      const job = service.getQueue().jobs.find((candidate) => candidate.id === id);
      return job?.kind === "clip" && job.source?.clip
        ? clipDownloads.retryClip(id)
        : jobResult(service.retry(id));
    });

    handle(IPC_CHANNELS.DOWNLOADS_REMOVE, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      return id ? fileActions.removeFromList(id) : { success: false, error: "id is required" };
    });

    handle(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      return id ? fileActions.showInFolder(id) : { success: false, error: "id is required" };
    });

    handle(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      return id ? fileActions.openFile(id) : { success: false, error: "id is required" };
    });

    handle(IPC_CHANNELS.DOWNLOADS_DELETE_FILE, (event, payload) => {
      if (!isAllowedSender(event)) return REJECTED;
      const id = idFromPayload(payload);
      return id ? fileActions.deleteFile(id) : { success: false, error: "id is required" };
    });

    const unsubscribe = service.subscribe((snapshot) => {
      renderer.send(IPC_CHANNELS.DOWNLOADS_QUEUE_CHANGED, snapshot);
    });
    registerLoadedFeatureCleanup("downloads:queue-events", unsubscribe);
  } catch (error) {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    throw error;
  }
}
