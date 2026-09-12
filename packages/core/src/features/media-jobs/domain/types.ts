import type { SerializedTimestamp } from "../../../foundations/contract-schema.ts";

export const MEDIA_JOB_SCHEMA_VERSION = 1 as const;
export const MEDIA_JOB_FIXTURE_DOWNLOAD_URI = "streamfusion-fixture://download";
export const MEDIA_JOB_FIXTURE_RECORDING_URI =
  "streamfusion-fixture://recording";
export const MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI =
  "streamfusion-fixture://download?storage-pressure";

declare const mediaJobIdBrand: unique symbol;
declare const mediaJobGenerationBrand: unique symbol;

export type MediaJobId = string & { readonly [mediaJobIdBrand]: true };
export type MediaJobGeneration = number & {
  readonly [mediaJobGenerationBrand]: true;
};

export type MediaJobKind = "download" | "recording";

export type MediaJobPhase =
  | "queued"
  | "preparing"
  | "running"
  | "pausing"
  | "paused"
  | "finalizing"
  | "completed"
  | "failed-retryable"
  | "failed-terminal"
  | "canceled";

export type MediaJobCommandName =
  "start" | "pause" | "resume" | "cancel" | "retry" | "recover" | "finalize";

export type MediaJobFailureCode =
  "storage-pressure" | "source-unavailable" | "interrupted" | "native-failure";

export interface MediaJobIntent {
  readonly schemaVersion: typeof MEDIA_JOB_SCHEMA_VERSION;
  readonly jobId: MediaJobId;
  readonly kind: MediaJobKind;
  readonly sourceUri: string;
  readonly createdAt: SerializedTimestamp;
}

export type MediaJobArtifactStatus =
  | { readonly kind: "none" }
  | {
      readonly kind: "partial";
      readonly relativePath: string;
      readonly bytes: number;
    }
  | {
      readonly kind: "complete";
      readonly relativePath: string;
      readonly bytes: number;
    };

export interface MediaJobCheckpoint {
  readonly generation: MediaJobGeneration;
  readonly byteOffset: number;
  readonly durationMs: number;
  readonly updatedAt: SerializedTimestamp;
}

export type MediaJobServiceOwnership =
  | { readonly kind: "unowned" }
  | { readonly kind: "owned"; readonly notificationVisible: true };

export interface MediaJobProgress {
  readonly transferredBytes: number;
  readonly totalBytes: number | null;
  readonly durationMs: number;
}

export interface MediaJobSnapshot {
  readonly schemaVersion: typeof MEDIA_JOB_SCHEMA_VERSION;
  readonly intent: MediaJobIntent;
  readonly phase: MediaJobPhase;
  readonly progress: MediaJobProgress;
  readonly checkpoint: MediaJobCheckpoint | null;
  readonly artifact: MediaJobArtifactStatus;
  readonly service: MediaJobServiceOwnership;
  readonly statusMessage: string;
  readonly failureCode: MediaJobFailureCode | null;
}

export interface MediaJobFileEvidence {
  readonly relativePath: string;
  readonly bytes: number;
  readonly completeMarker: boolean;
}

export interface MediaJobNativeJournal {
  readonly jobId: MediaJobId;
  readonly kind: MediaJobKind;
  readonly generation: MediaJobGeneration;
  readonly phase: MediaJobPhase;
  readonly checkpoint: MediaJobCheckpoint | null;
  readonly artifact: MediaJobArtifactStatus;
  readonly serviceOwned: boolean;
  readonly failureCode: MediaJobFailureCode | null;
  readonly statusMessage: string;
}

export type MediaJobCommand =
  | { readonly kind: "start"; readonly intent: MediaJobIntent }
  | { readonly kind: "pause"; readonly jobId: MediaJobId }
  | { readonly kind: "resume"; readonly jobId: MediaJobId }
  | { readonly kind: "cancel"; readonly jobId: MediaJobId }
  | { readonly kind: "retry"; readonly jobId: MediaJobId }
  | { readonly kind: "recover"; readonly jobId: MediaJobId }
  | { readonly kind: "finalize"; readonly jobId: MediaJobId };

export type MediaJobCommandResult =
  | { readonly kind: "ok"; readonly snapshot: MediaJobSnapshot }
  | { readonly kind: "ignored"; readonly snapshot: MediaJobSnapshot }
  | { readonly kind: "rejected"; readonly reason: string };

export const MEDIA_JOB_PHASES = [
  "queued",
  "preparing",
  "running",
  "pausing",
  "paused",
  "finalizing",
  "completed",
  "failed-retryable",
  "failed-terminal",
  "canceled",
] as const;

export const MEDIA_JOB_IN_FLIGHT_PHASES = [
  "queued",
  "preparing",
  "running",
  "pausing",
  "finalizing",
] as const satisfies readonly MediaJobPhase[];

export const MEDIA_JOB_ACTIVITY_TERMINAL_PHASES = [
  "completed",
  "failed-terminal",
  "canceled",
] as const satisfies readonly MediaJobPhase[];

const JOB_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,256}$/u;

export function isMediaJobId(value: unknown): value is MediaJobId {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function asMediaJobId(value: string): MediaJobId {
  if (!isMediaJobId(value)) {
    throw new RangeError("Media Job id must be a safe identifier.");
  }
  return value;
}

export function isMediaJobGeneration(
  value: unknown,
): value is MediaJobGeneration {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function asMediaJobGeneration(value: number): MediaJobGeneration {
  if (!isMediaJobGeneration(value)) {
    throw new RangeError(
      "Media Job generation must be an integer of 1 or more.",
    );
  }
  return value;
}

export function isMediaJobPhase(value: unknown): value is MediaJobPhase {
  return (
    typeof value === "string" &&
    (MEDIA_JOB_PHASES as readonly string[]).includes(value)
  );
}

export function isInFlightMediaJobPhase(phase: MediaJobPhase): boolean {
  return (MEDIA_JOB_IN_FLIGHT_PHASES as readonly MediaJobPhase[]).includes(
    phase,
  );
}

export function isActivityTerminalMediaJobPhase(phase: MediaJobPhase): boolean {
  return (
    MEDIA_JOB_ACTIVITY_TERMINAL_PHASES as readonly MediaJobPhase[]
  ).includes(phase);
}

export function intentsEqual(
  left: MediaJobIntent,
  right: MediaJobIntent,
): boolean {
  return (
    left.jobId === right.jobId &&
    left.kind === right.kind &&
    left.sourceUri === right.sourceUri
  );
}

export function snapshotGeneration(
  snapshot: MediaJobSnapshot | null,
): MediaJobGeneration | null {
  return snapshot?.checkpoint?.generation ?? null;
}
