import type { SerializedTimestamp } from "../../../foundations/contract-schema.ts";
import {
  asMediaJobGeneration,
  intentsEqual,
  type MediaJobCommand,
  type MediaJobCommandName,
  type MediaJobCommandResult,
  type MediaJobIntent,
  type MediaJobPhase,
  type MediaJobSnapshot,
} from "./types.ts";

const COMMANDS_BY_PHASE: Record<
  MediaJobPhase,
  readonly Exclude<MediaJobCommandName, "start">[]
> = {
  queued: ["cancel", "recover"],
  preparing: ["cancel", "recover"],
  running: ["pause", "cancel", "finalize", "recover"],
  pausing: ["cancel", "recover"],
  paused: ["resume", "cancel", "finalize", "recover"],
  finalizing: ["recover"],
  completed: ["recover"],
  "failed-retryable": ["retry", "cancel", "finalize", "recover"],
  "failed-terminal": ["recover"],
  canceled: ["retry", "recover"],
};

export function validCommands(
  phase: MediaJobPhase,
): readonly Exclude<MediaJobCommandName, "start">[] {
  return COMMANDS_BY_PHASE[phase];
}

export function commandIsValid(
  phase: MediaJobPhase,
  command: MediaJobCommandName,
): boolean {
  if (command === "start") return false;
  return COMMANDS_BY_PHASE[phase].includes(command);
}

export function createQueuedMediaJobSnapshot(
  intent: MediaJobIntent,
): MediaJobSnapshot {
  return {
    schemaVersion: 1,
    intent,
    phase: "queued",
    progress: { transferredBytes: 0, totalBytes: null, durationMs: 0 },
    checkpoint: {
      generation: asMediaJobGeneration(1),
      byteOffset: 0,
      durationMs: 0,
      updatedAt: intent.createdAt,
    },
    artifact: { kind: "none" },
    service: { kind: "unowned" },
    statusMessage: "Queued",
    failureCode: null,
  };
}

export function applyCommand(
  snapshot: MediaJobSnapshot | null,
  command: MediaJobCommand,
  now: SerializedTimestamp,
): MediaJobCommandResult {
  if (command.kind === "start") {
    return applyStart(snapshot, command.intent);
  }
  if (!snapshot) {
    return { kind: "rejected", reason: "Media Job does not exist." };
  }
  if (snapshot.intent.jobId !== command.jobId) {
    return { kind: "rejected", reason: "Command job id does not match." };
  }
  if (!commandIsValid(snapshot.phase, command.kind)) {
    return {
      kind: "rejected",
      reason: `${command.kind} is not valid while ${snapshot.phase}.`,
    };
  }
  switch (command.kind) {
    case "pause":
      return ok({
        ...snapshot,
        phase: "pausing",
        statusMessage: "Pausing",
        failureCode: null,
      });
    case "resume":
      return ok({
        ...snapshot,
        phase: "running",
        service: { kind: "owned", notificationVisible: true },
        statusMessage: "Running",
        failureCode: null,
      });
    case "cancel":
      return ok({
        ...snapshot,
        phase: "canceled",
        service: { kind: "unowned" },
        statusMessage: "Canceled",
        failureCode: null,
      });
    case "retry":
      return ok(retrySnapshot(snapshot, now));
    case "finalize":
      return ok({
        ...snapshot,
        phase: "finalizing",
        statusMessage: "Finalizing",
        failureCode: null,
      });
    case "recover":
      return { kind: "ignored", snapshot };
  }
}

function applyStart(
  snapshot: MediaJobSnapshot | null,
  intent: MediaJobIntent,
): MediaJobCommandResult {
  if (!snapshot) {
    return ok(createQueuedMediaJobSnapshot(intent));
  }
  if (intentsEqual(snapshot.intent, intent)) {
    return { kind: "ignored", snapshot };
  }
  return {
    kind: "rejected",
    reason: "A Media Job with this id already has a different intent.",
  };
}

function retrySnapshot(
  snapshot: MediaJobSnapshot,
  now: SerializedTimestamp,
): MediaJobSnapshot {
  const generation = asMediaJobGeneration(
    (snapshot.checkpoint?.generation ?? 1) + 1,
  );
  return {
    ...snapshot,
    phase: "queued",
    service: { kind: "unowned" },
    statusMessage: "Queued",
    failureCode: null,
    checkpoint: {
      generation,
      byteOffset: snapshot.progress.transferredBytes,
      durationMs: snapshot.progress.durationMs,
      updatedAt: now,
    },
  };
}

function ok(snapshot: MediaJobSnapshot): MediaJobCommandResult {
  return { kind: "ok", snapshot };
}
