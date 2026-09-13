import { describe, expect, it } from "vitest";

import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  asMediaJobGeneration,
  asMediaJobId,
  createQueuedMediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";

import type { AndroidMediaJobsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import { createMediaJobWorkflow } from "../domain/media-job-workflow";
import type { MediaJobRepository } from "../capabilities/media-jobs";

const now = toSerializedTimestamp("2026-09-12T01:00:00.000Z");

function journal(jobId: string) {
  return {
    jobId: asMediaJobId(jobId),
    kind: "download" as const,
    generation: asMediaJobGeneration(1),
    phase: "running" as const,
    checkpoint: {
      generation: asMediaJobGeneration(1),
      byteOffset: 4096,
      durationMs: 120,
      updatedAt: now,
    },
    artifact: {
      kind: "partial" as const,
      relativePath: `media-jobs/${jobId}/artifact.bin`,
      bytes: 4096,
    },
    serviceOwned: true,
    failureCode: null,
    statusMessage: "Running",
  };
}

describe("Media Job workflow", () => {
  it("starts a fixture job, projects Activity, and keeps readAt on recover", async () => {
    const stored = new Map();
    const activityItems: Parameters<ActivityRepository["record"]>[0][] = [];
    const product: MediaJobRepository = {
      async get(jobId) {
        return stored.get(jobId) ?? null;
      },
      async list() {
        return [...stored.values()];
      },
      async put(snapshot) {
        stored.set(snapshot.intent.jobId, snapshot);
      },
    };
    const activity: ActivityRepository = {
      async dismissCompleted() {
        return {
          activeEventIds: [],
          alreadyDismissedEventIds: [],
          dismissedEventIds: [],
          missingEventIds: [],
        };
      },
      async list() {
        return activityItems;
      },
      async markAllRead() {
        return 0;
      },
      async markRead() {
        return null;
      },
      async record(item) {
        const existing = activityItems.find(
          (candidate) => candidate.eventId === item.eventId,
        );
        if (existing && existing.kind === "job" && item.kind === "job") {
          const next = {
            ...item,
            readAt: existing.readAt,
            occurredAt: existing.occurredAt,
          };
          activityItems.splice(activityItems.indexOf(existing), 1, next);
          return { item: next, kind: "reconciled" };
        }
        activityItems.push(item);
        return { item, kind: "created" };
      },
    };
    const native = {
      readiness: () => ({
        capability: "media-jobs",
        contractVersion: 2,
        kind: "ready",
      }),
      startRecoverableJob: async () => ({
        kind: "completed",
        value: {
          kind: "record",
          journal: journal("job-download-1"),
          files: {
            relativePath: "media-jobs/job-download-1/artifact.bin",
            bytes: 4096,
            completeMarker: false,
          },
        },
      }),
      recoverJobs: async () => ({ kind: "completed", value: [] }),
      cancelRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      pauseRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      resumeRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      retryRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      finalizeRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      getRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
    } as unknown as AndroidMediaJobsContractPort;

    const workflow = createMediaJobWorkflow({ activity, native, product });
    const result = await workflow.start({
      schemaVersion: 1,
      jobId: asMediaJobId("job-download-1"),
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt: now,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.snapshot.phase).toBe("running");
    expect(activityItems[0]?.kind).toBe("job");
    if (activityItems[0]?.kind === "job") {
      activityItems[0] = { ...activityItems[0], readAt: now };
    }
    stored.set(
      "job-download-1",
      createQueuedMediaJobSnapshot({
        schemaVersion: 1,
        jobId: asMediaJobId("job-download-1"),
        kind: "download",
        sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
        createdAt: now,
      }),
    );
    native.recoverJobs = async () => ({
      kind: "completed",
      value: [
        {
          kind: "record",
          journal: { ...journal("job-download-1"), serviceOwned: false },
          files: {
            relativePath: "media-jobs/job-download-1/artifact.bin",
            bytes: 4096,
            completeMarker: false,
          },
        },
      ],
    });
    const recovered = await workflow.recoverAll(now);
    expect(recovered[0]?.phase).toBe("paused");
    expect(activityItems[0]?.readAt).toBe(now);
  });

  it("recovers each stored job when the native list result is unusable", async () => {
    const stored = new Map();
    const queued = createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("download-1"),
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt: now,
    });
    stored.set("download-1", queued);
    const product: MediaJobRepository = {
      async get(jobId) {
        return stored.get(jobId) ?? null;
      },
      async list() {
        return [...stored.values()];
      },
      async put(snapshot) {
        stored.set(snapshot.intent.jobId, snapshot);
      },
    };
    const activity: ActivityRepository = {
      async dismissCompleted() {
        return {
          activeEventIds: [],
          alreadyDismissedEventIds: [],
          dismissedEventIds: [],
          missingEventIds: [],
        };
      },
      async list() {
        return [];
      },
      async markAllRead() {
        return 0;
      },
      async markRead() {
        return null;
      },
      async record() {
        return {
          item: {
            kind: "job",
            eventId: "job:download-1",
            body: "Completed",
            occurredAt: now,
            readAt: null,
            job: { id: "download-1", state: { kind: "terminal" } },
          },
          kind: "created",
        };
      },
    };
    const native = {
      readiness: () => ({
        capability: "media-jobs",
        contractVersion: 2,
        kind: "ready",
      }),
      startRecoverableJob: async () => ({
        kind: "unavailable",
        failure: { code: "NATIVE_RESULT_INVALID", diagnostic: "bad" },
      }),
      recoverJobs: async () => ({
        kind: "unavailable",
        failure: { code: "NATIVE_RESULT_INVALID", diagnostic: "bad list" },
      }),
      cancelRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      pauseRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      resumeRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      retryRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      finalizeRecoverableJob: async () => ({
        kind: "completed",
        value: { kind: "missing", jobId: "x" },
      }),
      getRecoverableJob: async () => ({
        kind: "completed",
        value: {
          kind: "record",
          journal: {
            ...journal("download-1"),
            phase: "completed",
            serviceOwned: false,
            statusMessage: "Completed",
            artifact: {
              kind: "complete",
              relativePath: "media-jobs/download-1/artifact.bin",
              bytes: 65536,
            },
          },
          files: {
            relativePath: "media-jobs/download-1/artifact.bin",
            bytes: 65536,
            completeMarker: true,
          },
        },
      }),
    } as unknown as AndroidMediaJobsContractPort;
    const workflow = createMediaJobWorkflow({ activity, native, product });
    const recovered = await workflow.recoverAll(now);
    expect(recovered[0]?.phase).toBe("completed");
    expect(recovered[0]?.artifact.kind).toBe("complete");
  });

  it("returns an ignored start without calling native", async () => {
    const stored = new Map();
    const queued = createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("job-download-1"),
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt: now,
    });
    stored.set("job-download-1", queued);
    let starts = 0;
    const workflow = createMediaJobWorkflow({
      activity: recordingActivity(),
      native: nativePort({
        startRecoverableJob: async () => {
          starts += 1;
          return {
            kind: "completed",
            value: {
              kind: "record",
              journal: journal("job-download-1"),
              files: null,
            },
          };
        },
      }),
      product: memoryProduct(stored),
    });
    const result = await workflow.start({
      schemaVersion: 1,
      jobId: asMediaJobId("job-download-1"),
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt: now,
    });
    expect(result.kind).toBe("ignored");
    expect(starts).toBe(0);
    expect(stored.get("job-download-1")?.phase).toBe("queued");
  });

  it("does not keep a pausing snapshot when native reports the job missing", async () => {
    const stored = new Map();
    const running = {
      ...createQueuedMediaJobSnapshot({
        schemaVersion: 1,
        jobId: asMediaJobId("job-download-1"),
        kind: "download",
        sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
        createdAt: now,
      }),
      phase: "running" as const,
      statusMessage: "Running",
    };
    stored.set("job-download-1", running);
    const workflow = createMediaJobWorkflow({
      activity: recordingActivity(),
      native: nativePort({
        pauseRecoverableJob: async () => ({
          kind: "completed",
          value: { kind: "missing", jobId: "job-download-1" },
        }),
      }),
      product: memoryProduct(stored),
    });
    const result = await workflow.apply(
      { kind: "pause", jobId: asMediaJobId("job-download-1") },
      now,
    );
    expect(result.kind).toBe("rejected");
    expect(stored.get("job-download-1")?.phase).toBe("running");
  });

  it("keeps recover ignored after native reconciliation", async () => {
    const stored = new Map();
    const running = {
      ...createQueuedMediaJobSnapshot({
        schemaVersion: 1,
        jobId: asMediaJobId("job-download-1"),
        kind: "download",
        sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
        createdAt: now,
      }),
      phase: "running" as const,
      statusMessage: "Running",
    };
    stored.set("job-download-1", running);
    const workflow = createMediaJobWorkflow({
      activity: recordingActivity(),
      native: nativePort({
        getRecoverableJob: async () => ({
          kind: "completed",
          value: {
            kind: "record",
            journal: { ...journal("job-download-1"), serviceOwned: false },
            files: {
              relativePath: "media-jobs/job-download-1/artifact.bin",
              bytes: 4096,
              completeMarker: false,
            },
          },
        }),
      }),
      product: memoryProduct(stored),
    });
    const result = await workflow.apply(
      { kind: "recover", jobId: asMediaJobId("job-download-1") },
      now,
    );
    expect(result.kind).toBe("ignored");
    if (result.kind !== "ignored") return;
    expect(result.snapshot.phase).toBe("paused");
  });

  it("projects a stored job when fallback recovery cannot read native state", async () => {
    const stored = new Map();
    const queued = createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("download-1"),
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt: now,
    });
    stored.set("download-1", queued);
    const recorded: unknown[] = [];
    const workflow = createMediaJobWorkflow({
      activity: {
        ...recordingActivity(),
        async record(item) {
          recorded.push(item);
          return { item, kind: "created" };
        },
      },
      native: nativePort({
        recoverJobs: async () => ({
          kind: "unavailable",
          failure: { code: "NATIVE_RESULT_INVALID", diagnostic: "bad list" },
        }),
        getRecoverableJob: async () => ({
          kind: "completed",
          value: { kind: "missing", jobId: "download-1" },
        }),
      }),
      product: memoryProduct(stored),
    });
    const recovered = await workflow.recoverAll(now);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.phase).toBe("queued");
    expect(recorded).toHaveLength(1);
  });
});

function memoryProduct(
  stored: Map<string, ReturnType<typeof createQueuedMediaJobSnapshot>>,
) {
  return {
    async get(jobId: string) {
      return stored.get(jobId) ?? null;
    },
    async list() {
      return [...stored.values()];
    },
    async put(snapshot: ReturnType<typeof createQueuedMediaJobSnapshot>) {
      stored.set(snapshot.intent.jobId, snapshot);
    },
  };
}

function recordingActivity(): ActivityRepository {
  return {
    async dismissCompleted() {
      return {
        activeEventIds: [],
        alreadyDismissedEventIds: [],
        dismissedEventIds: [],
        missingEventIds: [],
      };
    },
    async list() {
      return [];
    },
    async markAllRead() {
      return 0;
    },
    async markRead() {
      return null;
    },
    async record(item) {
      return { item, kind: "created" };
    },
  };
}

function nativePort(
  overrides: Partial<AndroidMediaJobsContractPort>,
): AndroidMediaJobsContractPort {
  return {
    readiness: () => ({
      capability: "media-jobs",
      contractVersion: 2,
      kind: "ready",
    }),
    startRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    recoverJobs: async () => ({ kind: "completed", value: [] }),
    cancelRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    pauseRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    resumeRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    retryRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    finalizeRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    getRecoverableJob: async () => ({
      kind: "completed",
      value: { kind: "missing", jobId: "x" },
    }),
    ...overrides,
  } as AndroidMediaJobsContractPort;
}
