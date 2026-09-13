import type {
  MediaJobCommand,
  MediaJobCommandResult,
  MediaJobIntent,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";

export interface MediaJobRepository {
  get(jobId: string): Promise<MediaJobSnapshot | null>;
  list(): Promise<readonly MediaJobSnapshot[]>;
  put(snapshot: MediaJobSnapshot): Promise<void>;
}

export interface MediaJobWorkflow {
  apply(command: MediaJobCommand, nowIso: string): Promise<MediaJobCommandResult>;
  list(): Promise<readonly MediaJobSnapshot[]>;
  recoverAll(nowIso: string): Promise<readonly MediaJobSnapshot[]>;
  start(intent: MediaJobIntent): Promise<MediaJobCommandResult>;
}
