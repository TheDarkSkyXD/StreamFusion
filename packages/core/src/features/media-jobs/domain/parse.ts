import {
  hasOnlyKeys,
  isNonNegativeNumber,
  isRecord,
  isSerializedTimestamp,
  isString,
  type ContractSchema,
} from "../../../foundations/contract-schema.ts";
import {
  parseNativeFileEvidence,
  parseNativeJournal,
} from "./parse-journal.ts";
import {
  MEDIA_JOB_SCHEMA_VERSION,
  asMediaJobGeneration,
  asMediaJobId,
  isActivityTerminalMediaJobPhase,
  isInFlightMediaJobPhase,
  isMediaJobGeneration,
  isMediaJobId,
  isMediaJobPhase,
  type MediaJobArtifactStatus,
  type MediaJobCheckpoint,
  type MediaJobCommand,
  type MediaJobFailureCode,
  type MediaJobFileEvidence,
  type MediaJobIntent,
  type MediaJobKind,
  type MediaJobNativeJournal,
  type MediaJobPhase,
  type MediaJobProgress,
  type MediaJobServiceOwnership,
  type MediaJobSnapshot,
} from "./types.ts";

const INTENT_KEYS = [
  "schemaVersion",
  "jobId",
  "kind",
  "sourceUri",
  "createdAt",
] as const;

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "intent",
  "phase",
  "progress",
  "checkpoint",
  "artifact",
  "service",
  "statusMessage",
  "failureCode",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isKind(value: unknown): value is MediaJobKind {
  return value === "download" || value === "recording";
}

function isFailureCode(value: unknown): value is MediaJobFailureCode {
  return (
    value === "storage-pressure" ||
    value === "source-unavailable" ||
    value === "interrupted" ||
    value === "native-failure"
  );
}

function isArtifact(value: unknown): value is MediaJobArtifactStatus {
  if (!isRecord(value)) return false;
  if (value.kind === "none") return hasOnlyKeys(value, ["kind"]);
  return (
    (value.kind === "partial" || value.kind === "complete") &&
    hasOnlyKeys(value, ["kind", "relativePath", "bytes"]) &&
    isNonEmptyString(value.relativePath) &&
    isNonNegativeNumber(value.bytes)
  );
}

function isProgress(value: unknown): value is MediaJobProgress {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["transferredBytes", "totalBytes", "durationMs"]) &&
    isNonNegativeNumber(value.transferredBytes) &&
    (value.totalBytes === null || isNonNegativeNumber(value.totalBytes)) &&
    isNonNegativeNumber(value.durationMs)
  );
}

function isCheckpoint(value: unknown): value is MediaJobCheckpoint {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "generation",
      "byteOffset",
      "durationMs",
      "updatedAt",
    ]) &&
    isMediaJobGeneration(value.generation) &&
    isNonNegativeNumber(value.byteOffset) &&
    isNonNegativeNumber(value.durationMs) &&
    isSerializedTimestamp(value.updatedAt)
  );
}

function isService(value: unknown): value is MediaJobServiceOwnership {
  if (!isRecord(value)) return false;
  if (value.kind === "unowned") return hasOnlyKeys(value, ["kind"]);
  return (
    value.kind === "owned" &&
    hasOnlyKeys(value, ["kind", "notificationVisible"]) &&
    value.notificationVisible === true
  );
}

function isIntent(value: unknown): value is MediaJobIntent {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, INTENT_KEYS) &&
    value.schemaVersion === MEDIA_JOB_SCHEMA_VERSION &&
    isMediaJobId(value.jobId) &&
    isKind(value.kind) &&
    isNonEmptyString(value.sourceUri) &&
    isSerializedTimestamp(value.createdAt)
  );
}

function isSnapshot(value: unknown): value is MediaJobSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS)) return false;
  if (value.schemaVersion !== MEDIA_JOB_SCHEMA_VERSION) return false;
  if (!isIntent(value.intent) || !isMediaJobPhase(value.phase)) return false;
  if (!isProgress(value.progress)) return false;
  if (value.checkpoint !== null && !isCheckpoint(value.checkpoint))
    return false;
  if (!isArtifact(value.artifact) || !isService(value.service)) return false;
  if (!isString(value.statusMessage)) return false;
  if (value.failureCode !== null && !isFailureCode(value.failureCode)) {
    return false;
  }
  return true;
}

function isJournal(value: unknown): value is MediaJobNativeJournal {
  return parseNativeJournal(value) !== null;
}

function isFileEvidence(value: unknown): value is MediaJobFileEvidence {
  return parseNativeFileEvidence(value) !== null;
}

export const mediaJobIntentSchema: ContractSchema<MediaJobIntent> = {
  is: isIntent,
};

export const mediaJobSnapshotSchema: ContractSchema<MediaJobSnapshot> = {
  is: isSnapshot,
};

export const mediaJobNativeJournalSchema: ContractSchema<MediaJobNativeJournal> =
  { is: isJournal };

export const mediaJobFileEvidenceSchema: ContractSchema<MediaJobFileEvidence> =
  {
    is: isFileEvidence,
  };

export function parseMediaJobIntent(value: unknown): MediaJobIntent | null {
  return isIntent(value) ? value : null;
}

export function parseMediaJobSnapshot(value: unknown): MediaJobSnapshot | null {
  return isSnapshot(value) ? value : null;
}

export function parseMediaJobNativeJournal(
  value: unknown,
): MediaJobNativeJournal | null {
  return parseNativeJournal(value);
}

export function parseMediaJobFileEvidence(
  value: unknown,
): MediaJobFileEvidence | null {
  return parseNativeFileEvidence(value);
}

export function parseMediaJobCommand(value: unknown): MediaJobCommand | null {
  if (!isRecord(value) || !isString(value.kind)) return null;
  if (value.kind === "start") {
    return isIntent(value.intent) && hasOnlyKeys(value, ["kind", "intent"])
      ? { kind: "start", intent: value.intent }
      : null;
  }
  if (!hasOnlyKeys(value, ["kind", "jobId"]) || !isMediaJobId(value.jobId)) {
    return null;
  }
  const jobId = asMediaJobId(value.jobId);
  switch (value.kind) {
    case "pause":
    case "resume":
    case "cancel":
    case "retry":
    case "recover":
    case "finalize":
      return { kind: value.kind, jobId };
    default:
      return null;
  }
}

export function parseMediaJobPhase(value: unknown): MediaJobPhase | null {
  return isMediaJobPhase(value) ? value : null;
}

export function requireMediaJobId(
  value: string,
): ReturnType<typeof asMediaJobId> {
  return asMediaJobId(value);
}

export function requireMediaJobGeneration(
  value: number,
): ReturnType<typeof asMediaJobGeneration> {
  return asMediaJobGeneration(value);
}

export function describePhaseClass(
  phase: MediaJobPhase,
): "in-flight" | "terminal" | "held" {
  if (isInFlightMediaJobPhase(phase)) return "in-flight";
  if (isActivityTerminalMediaJobPhase(phase)) return "terminal";
  return "held";
}
