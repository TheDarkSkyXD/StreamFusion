import type { DownloadController } from "../../capabilities/download-controller";

type DownloadBridge = typeof window.electronAPI.downloads;

/** Electron implementation of the download queue port. */
export const electronDownloadController = {
  getQueue: () => window.electronAPI.downloads.getQueue(),
  downloadClip: (...args: Parameters<DownloadBridge["downloadClip"]>) =>
    window.electronAPI.downloads.downloadClip(...args),
  downloadVideo: (...args: Parameters<DownloadBridge["downloadVideo"]>) =>
    window.electronAPI.downloads.downloadVideo(...args),
  pause: (...args: Parameters<DownloadBridge["pause"]>) => window.electronAPI.downloads.pause(...args),
  resume: (...args: Parameters<DownloadBridge["resume"]>) =>
    window.electronAPI.downloads.resume(...args),
  cancel: (...args: Parameters<DownloadBridge["cancel"]>) =>
    window.electronAPI.downloads.cancel(...args),
  retry: (...args: Parameters<DownloadBridge["retry"]>) => window.electronAPI.downloads.retry(...args),
  remove: (...args: Parameters<DownloadBridge["remove"]>) =>
    window.electronAPI.downloads.remove(...args),
  showInFolder: (...args: Parameters<DownloadBridge["showInFolder"]>) =>
    window.electronAPI.downloads.showInFolder(...args),
  openFile: (...args: Parameters<DownloadBridge["openFile"]>) =>
    window.electronAPI.downloads.openFile(...args),
  deleteFile: (...args: Parameters<DownloadBridge["deleteFile"]>) =>
    window.electronAPI.downloads.deleteFile(...args),
  onQueueChanged: (...args: Parameters<DownloadBridge["onQueueChanged"]>) =>
    window.electronAPI.downloads.onQueueChanged(...args),
} satisfies DownloadController;
