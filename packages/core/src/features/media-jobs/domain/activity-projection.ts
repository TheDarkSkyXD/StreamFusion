import {
  reconcileActivityItem,
  type JobActivityItem,
} from "../../activity/domain/index.ts";
import type { SerializedTimestamp } from "../../../foundations/contract-schema.ts";
import {
  isActivityTerminalMediaJobPhase,
  type MediaJobId,
  type MediaJobSnapshot,
} from "./types.ts";

export function mediaJobActivityEventId(jobId: MediaJobId): string {
  return `job:${jobId}`;
}

export function projectMediaJobActivity(
  snapshot: MediaJobSnapshot,
  existing: JobActivityItem | null,
  now: SerializedTimestamp,
): JobActivityItem {
  const incoming: JobActivityItem = {
    schemaVersion: 1,
    eventId: mediaJobActivityEventId(snapshot.intent.jobId),
    kind: "job",
    source: "local",
    occurredAt: existing?.occurredAt ?? now,
    readAt: null,
    title: snapshot.intent.kind === "download" ? "Download" : "Recording",
    body: snapshot.statusMessage,
    job: {
      id: snapshot.intent.jobId,
      state: {
        kind: isActivityTerminalMediaJobPhase(snapshot.phase)
          ? "terminal"
          : "active",
      },
    },
    destination: { kind: "media-job", jobId: snapshot.intent.jobId },
  };
  if (!existing) return incoming;
  const reconciled = reconcileActivityItem(existing, incoming);
  return reconciled.kind === "job" ? reconciled : incoming;
}
