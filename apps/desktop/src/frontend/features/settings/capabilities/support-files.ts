import type { BugReportResult } from "@shared/ipc-channels";

export interface LogReader {
  openFolder(): Promise<{ ok: boolean; error?: string }>;
  getCurrentPath(): Promise<string>;
  getNoisePath(): Promise<string | null>;
  getNetworkPath(): Promise<string | null>;
  tail(request: {
    lines: number;
    file: "main" | "noise" | "network";
    level?: "debug" | "info" | "warn" | "error";
    tag?: string;
    query?: string | string[];
  }): Promise<string[]>;
}

export interface BugReportWriter {
  write(request: {
    description: string;
    includeMainLog: boolean;
    includeNoiseLog: boolean;
  }): Promise<BugReportResult>;
  openFolder(): Promise<{ ok: boolean; error?: string }>;
  list(): Promise<string[]>;
}
