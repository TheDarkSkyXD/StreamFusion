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
  remove(jobId: string): Promise<void>;
}

export interface MediaJobWorkflow {
  apply(command: MediaJobCommand, nowIso: string): Promise<MediaJobCommandResult>;
  delete(jobId: string, nowIso: string): Promise<MediaJobCommandResult>;
  exportJob(jobId: string): Promise<
    | { readonly kind: "exported"; readonly matched: boolean; readonly destinationUri: string }
    | { readonly kind: "cancelled" }
    | { readonly kind: "rejected"; readonly reason: string }
  >;
  list(): Promise<readonly MediaJobSnapshot[]>;
  openArtifact(jobId: string): Promise<
    | { readonly kind: "opened" }
    | { readonly kind: "rejected"; readonly reason: string }
  >;
  recoverAll(nowIso: string): Promise<readonly MediaJobSnapshot[]>;
  start(
    intent: MediaJobIntent,
    requestHeaders?: Readonly<Record<string, string>>,
  ): Promise<MediaJobCommandResult>;
}
