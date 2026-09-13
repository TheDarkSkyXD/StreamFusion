import { createQueuedMediaJobSnapshot } from "./commands.ts";
import {
  intentsEqual,
  isActivityTerminalMediaJobPhase,
  isInFlightMediaJobPhase,
  snapshotGeneration,
  type MediaJobArtifactStatus,
  type MediaJobCheckpoint,
  type MediaJobFileEvidence,
  type MediaJobIntent,
  type MediaJobNativeJournal,
  type MediaJobPhase,
  type MediaJobSnapshot,
} from "./types.ts";

export interface MediaJobReconcileInput {
  readonly intent: MediaJobIntent;
  readonly product: MediaJobSnapshot | null;
  readonly journal: MediaJobNativeJournal | null;
  readonly files: MediaJobFileEvidence | null;
}

export function reconcileMediaJob(
  input: MediaJobReconcileInput,
): MediaJobSnapshot {
  const product = matchingProduct(input.product, input.intent);
  const base = product ?? createQueuedMediaJobSnapshot(input.intent);
  const journal = matchingJournal(input.journal, input.intent, base);
  const merged = journal
    ? mergeJournal(base, journal, input.files)
    : overlayFiles(base, input.files, false);
  return {
    ...merged,
    intent: input.intent,
    artifact: artifactFrom(merged.artifact, input.files),
    progress: progressFrom(merged, input.files),
  };
}

function matchingProduct(
  product: MediaJobSnapshot | null,
  intent: MediaJobIntent,
): MediaJobSnapshot | null {
  return product && intentsEqual(product.intent, intent) ? product : null;
}

function matchingJournal(
  journal: MediaJobNativeJournal | null,
  intent: MediaJobIntent,
  product: MediaJobSnapshot,
): MediaJobNativeJournal | null {
  if (
    !journal ||
    journal.jobId !== intent.jobId ||
    journal.kind !== intent.kind
  ) {
    return null;
  }
  if (
    journal.checkpoint &&
    journal.checkpoint.generation !== journal.generation
  ) {
    return null;
  }
  const productGeneration = snapshotGeneration(product);
  if (productGeneration !== null && journal.generation < productGeneration) {
    return null;
  }
  return journal;
}

function mergeJournal(
  product: MediaJobSnapshot,
  journal: MediaJobNativeJournal,
  files: MediaJobFileEvidence | null,
): MediaJobSnapshot {
  const owned = journal.serviceOwned;
  const phase = owned ? journal.phase : recoverUnownedPhase(journal, files);
  const artifact = artifactFrom(journal.artifact, files);
  return {
    schemaVersion: 1,
    intent: product.intent,
    phase,
    progress: {
      transferredBytes:
        files?.bytes ??
        journal.checkpoint?.byteOffset ??
        product.progress.transferredBytes,
      totalBytes: product.progress.totalBytes,
      durationMs: journal.checkpoint?.durationMs ?? product.progress.durationMs,
    },
    checkpoint: checkpointFromJournal(journal, product),
    artifact,
    service: owned
      ? { kind: "owned", notificationVisible: true }
      : { kind: "unowned" },
    statusMessage: statusFor(phase, journal, files),
    failureCode: failureFor(phase, journal),
  };
}

function checkpointFromJournal(
  journal: MediaJobNativeJournal,
  product: MediaJobSnapshot,
): MediaJobCheckpoint {
  if (journal.checkpoint) return journal.checkpoint;
  return {
    generation: journal.generation,
    byteOffset:
      product.checkpoint?.byteOffset ?? product.progress.transferredBytes,
    durationMs: product.checkpoint?.durationMs ?? product.progress.durationMs,
    updatedAt: product.checkpoint?.updatedAt ?? product.intent.createdAt,
  };
}

function recoverUnownedPhase(
  journal: MediaJobNativeJournal,
  files: MediaJobFileEvidence | null,
): MediaJobPhase {
  if (journal.failureCode === "storage-pressure") return "failed-retryable";
  if (isActivityTerminalMediaJobPhase(journal.phase)) return journal.phase;
  if (journal.phase === "paused" || journal.phase === "failed-retryable") {
    return journal.phase;
  }
  if (!isInFlightMediaJobPhase(journal.phase)) return journal.phase;
  if (files?.completeMarker) return "completed";
  if (files && files.bytes > 0) {
    return journal.kind === "recording" ? "completed" : "paused";
  }
  if (journal.phase === "queued") return "queued";
  return "failed-retryable";
}

function overlayFiles(
  snapshot: MediaJobSnapshot,
  files: MediaJobFileEvidence | null,
  serviceOwned: boolean,
): MediaJobSnapshot {
  return {
    ...snapshot,
    artifact: artifactFrom(snapshot.artifact, files),
    progress: progressFrom(snapshot, files),
    service: serviceOwned
      ? { kind: "owned", notificationVisible: true }
      : { kind: "unowned" },
  };
}

function artifactFrom(
  current: MediaJobArtifactStatus,
  files: MediaJobFileEvidence | null,
): MediaJobArtifactStatus {
  if (!files) return current;
  if (files.completeMarker) {
    return {
      kind: "complete",
      relativePath: files.relativePath,
      bytes: files.bytes,
    };
  }
  if (files.bytes > 0) {
    return {
      kind: "partial",
      relativePath: files.relativePath,
      bytes: files.bytes,
    };
  }
  return { kind: "none" };
}

function progressFrom(
  snapshot: MediaJobSnapshot,
  files: MediaJobFileEvidence | null,
): MediaJobSnapshot["progress"] {
  return {
    transferredBytes: files?.bytes ?? snapshot.progress.transferredBytes,
    totalBytes: snapshot.progress.totalBytes,
    durationMs: snapshot.progress.durationMs,
  };
}

function statusFor(
  phase: MediaJobPhase,
  journal: MediaJobNativeJournal,
  files: MediaJobFileEvidence | null,
): string {
  if (phase === journal.phase && journal.statusMessage.length > 0) {
    return journal.statusMessage;
  }
  if (phase === "completed" && files && !files.completeMarker) {
    return "Recovered a playable partial recording.";
  }
  if (phase === "paused") return "Paused after interruption.";
  if (
    phase === "failed-retryable" &&
    journal.failureCode === "storage-pressure"
  ) {
    return "Stopped because storage is full.";
  }
  if (phase === "failed-retryable") return "Interrupted. Retry to continue.";
  return journal.statusMessage;
}

function failureFor(
  phase: MediaJobPhase,
  journal: MediaJobNativeJournal,
): MediaJobSnapshot["failureCode"] {
  if (phase !== "failed-retryable" && phase !== "failed-terminal") return null;
  if (journal.failureCode) return journal.failureCode;
  return phase === "failed-retryable" ? "interrupted" : journal.failureCode;
}
