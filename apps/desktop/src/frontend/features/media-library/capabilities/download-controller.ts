import type {
  ClipDownloadRequest,
  DownloadJob,
  DownloadQueueSnapshot,
  VideoDownloadRequest,
} from "@shared/download-types";

export type DownloadActionResult = { success: boolean; job?: DownloadJob; error?: string };
export type DownloadFileAction = "pause" | "resume" | "cancel" | "retry" | "remove" | "showInFolder" | "openFile";

/** Provider-neutral port for the persisted desktop download queue. */
export interface DownloadController {
  getQueue(): Promise<DownloadQueueSnapshot>;
  downloadClip(request: ClipDownloadRequest): Promise<{
    success: boolean;
    jobId?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  downloadVideo(request: VideoDownloadRequest): Promise<{
    success: boolean;
    jobId?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  pause(id: string): Promise<DownloadActionResult>;
  resume(id: string): Promise<DownloadActionResult>;
  cancel(id: string): Promise<DownloadActionResult>;
  retry(id: string): Promise<DownloadActionResult>;
  remove(id: string): Promise<{ success: boolean; error?: string }>;
  showInFolder(id: string): Promise<{ success: boolean; error?: string }>;
  openFile(id: string): Promise<{ success: boolean; error?: string }>;
  deleteFile(id: string): Promise<{ success: boolean; error?: string }>;
  onQueueChanged(callback: (snapshot: DownloadQueueSnapshot) => void): () => void;
}
