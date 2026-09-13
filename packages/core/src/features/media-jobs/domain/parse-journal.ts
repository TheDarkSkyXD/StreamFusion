import {
  isNonNegativeNumber,
  isSerializedTimestamp,
  isString,
  toSerializedTimestamp,
} from "../../../foundations/contract-schema.ts";
import { asFiniteNumber, asHostRecord } from "./host-record.ts";
import {
  asMediaJobGeneration,
  asMediaJobId,
  isMediaJobGeneration,
  isMediaJobId,
  isMediaJobPhase,
  type MediaJobArtifactStatus,
  type MediaJobCheckpoint,
  type MediaJobFailureCode,
  type MediaJobFileEvidence,
  type MediaJobKind,
  type MediaJobNativeJournal,
} from "./types.ts";

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

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function asTimestamp(value: unknown): string | undefined {
  if (isSerializedTimestamp(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return undefined;
    const iso = parsed.toISOString();
    return isSerializedTimestamp(iso) ? iso : undefined;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      const iso = parsed.toISOString();
      return isSerializedTimestamp(iso) ? iso : undefined;
    }
  }
  return undefined;
}

function pickCheckpoint(value: unknown): MediaJobCheckpoint | null {
  if (value === null) return null;
  const record = asHostRecord(value);
  const generation = record ? asFiniteNumber(record.generation) : undefined;
  const byteOffset = record ? asFiniteNumber(record.byteOffset) : undefined;
  const durationMs = record ? asFiniteNumber(record.durationMs) : undefined;
  if (
    !record ||
    generation === undefined ||
    !isMediaJobGeneration(generation) ||
    byteOffset === undefined ||
    !isNonNegativeNumber(byteOffset) ||
    durationMs === undefined ||
    !isNonNegativeNumber(durationMs) ||
    asTimestamp(record.updatedAt) === undefined
  ) {
    return null;
  }
  const updatedAt = asTimestamp(record.updatedAt);
  if (!updatedAt) return null;
  return {
    generation: asMediaJobGeneration(generation),
    byteOffset,
    durationMs,
    updatedAt: toSerializedTimestamp(updatedAt),
  };
}

function pickArtifact(value: unknown): MediaJobArtifactStatus | null {
  const record = asHostRecord(value);
  if (!record) return null;
  if (record.kind === "none") return { kind: "none" };
  const bytes = asFiniteNumber(record.bytes);
  if (
    (record.kind !== "partial" && record.kind !== "complete") ||
    !isNonEmptyString(record.relativePath) ||
    bytes === undefined ||
    !isNonNegativeNumber(bytes)
  ) {
    return null;
  }
  return {
    kind: record.kind,
    relativePath: record.relativePath,
    bytes,
  };
}

export function parseNativeJournal(
  value: unknown,
): MediaJobNativeJournal | null {
  const record = asHostRecord(value);
  if (!record) return null;
  const generation = asFiniteNumber(record.generation);
  const checkpoint =
    record.checkpoint === null ? null : pickCheckpoint(record.checkpoint);
  const artifact = pickArtifact(record.artifact);
  if (
    !isMediaJobId(record.jobId) ||
    !isKind(record.kind) ||
    generation === undefined ||
    !isMediaJobGeneration(generation) ||
    !isMediaJobPhase(record.phase) ||
    (record.checkpoint !== null && checkpoint === null) ||
    !artifact ||
    (record.serviceOwned !== true && record.serviceOwned !== false) ||
    (record.failureCode != null && !isFailureCode(record.failureCode)) ||
    !isString(record.statusMessage)
  ) {
    return null;
  }
  return {
    jobId: asMediaJobId(record.jobId),
    kind: record.kind,
    generation: asMediaJobGeneration(generation),
    phase: record.phase,
    checkpoint,
    artifact,
    serviceOwned: record.serviceOwned,
    failureCode: isFailureCode(record.failureCode) ? record.failureCode : null,
    statusMessage: record.statusMessage,
  };
}

export function parseNativeFileEvidence(
  value: unknown,
): MediaJobFileEvidence | null {
  const record = asHostRecord(value);
  const bytes = record ? asFiniteNumber(record.bytes) : undefined;
  if (
    !record ||
    !isNonEmptyString(record.relativePath) ||
    bytes === undefined ||
    !isNonNegativeNumber(bytes) ||
    (record.completeMarker !== true && record.completeMarker !== false)
  ) {
    return null;
  }
  return {
    relativePath: record.relativePath,
    bytes,
    completeMarker: record.completeMarker,
  };
}
