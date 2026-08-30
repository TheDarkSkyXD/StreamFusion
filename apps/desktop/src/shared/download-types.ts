import type { Platform } from "./auth-types";

export type DownloadJobKind = "clip" | "video";

export type DownloadJobStatus =
  "queued" | "downloading" | "paused" | "failed" | "waiting" | "completed" | "cancelled";

export interface DownloadProgress {
  percent: number | null;
  transferredBytes: number;
  totalBytes: number | null;
  bytesPerSecond?: number | null;
}

export interface ClipDownloadSource {
  clipId: string;
  clipUrl?: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
}

export interface ClipDownloadRequest {
  platform: Platform;
  clipId: string;
  title: string;
  channelName: string;
  clipUrl?: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
}

export interface VideoDownloadRequest {
  platform: Platform;
  videoId: string;
  title: string;
  channelName: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
  /** Already-entitled playable source resolved by the watch surface (not a public share URL). */
  playbackUrl?: string;
}

export interface DownloadJob {
  id: string;
  kind: DownloadJobKind;
  platform: Platform;
  sourceId: string;
  title: string;
  channelName: string;
  status: DownloadJobStatus;
  progress: DownloadProgress;
  destinationPath: string;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
  qualityLabel?: string | null;
  outputFormat?: "mp4" | "ts" | null;
  partial?: boolean;
  retryable?: boolean;
  statusMessage?: string | null;
  nextRetryAt?: string | null;
  source?: {
    clip?: ClipDownloadSource;
    video?: {
      videoId: string;
      durationSeconds?: number | null;
      thumbnailUrl?: string;
    };
  };
}

export interface DownloadQueueSnapshot {
  jobs: DownloadJob[];
}
