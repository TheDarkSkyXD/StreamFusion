import type { DownloadProgress } from "@shared/download-types";

export class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelledError";
  }
}

export interface FfmpegProgress {
  percent: number | null;
  transferredSeconds: number;
  totalSeconds: number | null;
  outputBytes?: number | null;
}

export interface DirectDownloadInput {
  url: string;
  destinationPath: string;
  signal: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}

export interface HlsDownloadInput {
  ffmpegPath: string;
  inputUrl: string;
  destinationPath: string;
  durationSeconds?: number | null;
  signal: AbortSignal;
  onProgress: (progress: FfmpegProgress) => void;
}
