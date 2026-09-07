import type { CheckFrequency } from "@shared/ipc-channels";

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string | null;
  releaseName: string | null;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateStatusSnapshot {
  status: string;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  allowPrerelease: boolean;
  autoCheckEnabled?: boolean;
  checkFrequency?: CheckFrequency;
  updateCheckUrl?: string;
}

export interface UpdateController {
  check(): Promise<
    Omit<
      UpdateStatusSnapshot,
      "progress" | "autoCheckEnabled" | "checkFrequency" | "updateCheckUrl"
    >
  >;
  download(): Promise<
    Omit<
      UpdateStatusSnapshot,
      "allowPrerelease" | "autoCheckEnabled" | "checkFrequency" | "updateCheckUrl"
    >
  >;
  install(): Promise<{ success: boolean }>;
  getStatus(): Promise<Required<UpdateStatusSnapshot>>;
  setAllowPrerelease(allow: boolean): Promise<{ status: string; allowPrerelease: boolean }>;
  setAutoCheck(settings: {
    enabled?: boolean;
    frequency?: CheckFrequency;
    updateCheckUrl?: string;
  }): Promise<{
    status: string;
    allowPrerelease: boolean;
    autoCheckEnabled: boolean;
    checkFrequency: CheckFrequency;
    updateCheckUrl: string;
  }>;
  onStatusChange(callback: (state: UpdateStatusSnapshot) => void): () => void;
  onProgress(callback: (progress: UpdateProgress) => void): () => void;
}
