import assert from "node:assert/strict";
import test from "node:test";

import {
  markActivityItemRead,
  toSerializedTimestamp,
} from "@streamfusion/core/activity";
import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
  applyCommand,
  asMediaJobId,
  commandIsValid,
  createQueuedMediaJobSnapshot,
  mediaJobSnapshotSchema,
  parseMediaJobCommand,
  parseMediaJobNativeJournal,
  parseMediaJobSnapshot,
  projectMediaJobActivity,
  reconcileMediaJob,
  validCommands,
} from "@streamfusion/core/media-jobs";

const now = toSerializedTimestamp("2026-09-12T00:00:00.000Z");
const later = toSerializedTimestamp("2026-09-12T00:01:00.000Z");

function intent(overrides = {}) {
  return {
    schemaVersion: 1,
    jobId: asMediaJobId("job-download-1"),
    kind: "download",
    sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
    createdAt: now,
    ...overrides,
  };
}

function recordingIntent() {
  return intent({
    jobId: asMediaJobId("job-recording-1"),
    kind: "recording",
    sourceUri: MEDIA_JOB_FIXTURE_RECORDING_URI,
  });
}

function journal(snapshot, overrides = {}) {
  return {
    jobId: snapshot.intent.jobId,
    kind: snapshot.intent.kind,
    generation: snapshot.checkpoint.generation,
    phase: snapshot.phase,
    checkpoint: snapshot.checkpoint,
    artifact: snapshot.artifact,
    serviceOwned: snapshot.service.kind === "owned",
    failureCode: snapshot.failureCode,
    statusMessage: snapshot.statusMessage,
    ...overrides,
  };
}

test("command table matches the Media Job state machine", () => {
  assert.deepEqual(validCommands("queued"), ["cancel", "recover"]);
  assert.deepEqual(validCommands("running"), [
    "pause",
    "cancel",
    "finalize",
    "recover",
  ]);
  assert.deepEqual(validCommands("paused"), [
    "resume",
    "cancel",
    "finalize",
    "recover",
  ]);
  assert.deepEqual(validCommands("failed-retryable"), [
    "retry",
    "cancel",
    "finalize",
    "recover",
  ]);
  assert.deepEqual(validCommands("canceled"), ["retry", "recover"]);
  assert.equal(commandIsValid("completed", "cancel"), false);
  assert.equal(commandIsValid("running", "start"), false);
});

test("start is idempotent for the same intent and rejects a conflicting intent", () => {
  const created = applyCommand(null, { kind: "start", intent: intent() }, now);
  assert.equal(created.kind, "ok");
  assert.equal(created.snapshot.phase, "queued");
  const again = applyCommand(
    created.snapshot,
    { kind: "start", intent: intent() },
    now,
  );
  assert.equal(again.kind, "ignored");
  const conflict = applyCommand(
    created.snapshot,
    {
      kind: "start",
      intent: intent({ sourceUri: MEDIA_JOB_FIXTURE_RECORDING_URI }),
    },
    now,
  );
  assert.equal(conflict.kind, "rejected");
});

test("pause resume cancel retry and finalize follow the command table", () => {
  const queued = createQueuedMediaJobSnapshot(intent());
  const running = {
    ...queued,
    phase: "running",
    service: { kind: "owned", notificationVisible: true },
    statusMessage: "Running",
  };
  const paused = applyCommand(
    running,
    { kind: "pause", jobId: running.intent.jobId },
    now,
  );
  assert.equal(paused.kind, "ok");
  assert.equal(paused.snapshot.phase, "pausing");
  const resumed = applyCommand(
    { ...paused.snapshot, phase: "paused" },
    { kind: "resume", jobId: running.intent.jobId },
    now,
  );
  assert.equal(resumed.snapshot.phase, "running");
  const canceled = applyCommand(
    running,
    { kind: "cancel", jobId: running.intent.jobId },
    now,
  );
  assert.equal(canceled.snapshot.phase, "canceled");
  const retried = applyCommand(
    canceled.snapshot,
    { kind: "retry", jobId: running.intent.jobId },
    later,
  );
  assert.equal(retried.snapshot.phase, "queued");
  assert.equal(retried.snapshot.checkpoint.generation, 2);
  const finalized = applyCommand(
    running,
    { kind: "finalize", jobId: running.intent.jobId },
    now,
  );
  assert.equal(finalized.snapshot.phase, "finalizing");
  const recover = applyCommand(
    running,
    { kind: "recover", jobId: running.intent.jobId },
    now,
  );
  assert.equal(recover.kind, "ignored");
});

test("process death leaves a download paused and a recording completed with a partial artifact", () => {
  const download = {
    ...createQueuedMediaJobSnapshot(intent()),
    phase: "running",
    service: { kind: "owned", notificationVisible: true },
    statusMessage: "Running",
  };
  const recoveredDownload = reconcileMediaJob({
    intent: download.intent,
    product: download,
    journal: journal(download, { serviceOwned: false, phase: "running" }),
    files: {
      relativePath: "media-jobs/job-download-1/artifact.bin",
      bytes: 4096,
      completeMarker: false,
    },
  });
  assert.equal(recoveredDownload.phase, "paused");
  assert.equal(recoveredDownload.artifact.kind, "partial");
  assert.equal(recoveredDownload.service.kind, "unowned");

  const recording = {
    ...createQueuedMediaJobSnapshot(recordingIntent()),
    phase: "running",
    service: { kind: "owned", notificationVisible: true },
    statusMessage: "Running",
  };
  const recoveredRecording = reconcileMediaJob({
    intent: recording.intent,
    product: recording,
    journal: journal(recording, { serviceOwned: false, phase: "running" }),
    files: {
      relativePath: "media-jobs/job-recording-1/artifact.bin",
      bytes: 2048,
      completeMarker: false,
    },
  });
  assert.equal(recoveredRecording.phase, "completed");
  assert.equal(recoveredRecording.artifact.kind, "partial");
});

test("missing files after an in-flight death are failed-retryable and storage pressure preserves a partial", () => {
  const running = {
    ...createQueuedMediaJobSnapshot(intent()),
    phase: "running",
    statusMessage: "Running",
  };
  const missing = reconcileMediaJob({
    intent: running.intent,
    product: running,
    journal: journal(running, { serviceOwned: false }),
    files: null,
  });
  assert.equal(missing.phase, "failed-retryable");
  assert.equal(missing.failureCode, "interrupted");

  const pressure = reconcileMediaJob({
    intent: running.intent,
    product: running,
    journal: journal(running, {
      serviceOwned: false,
      failureCode: "storage-pressure",
      artifact: {
        kind: "partial",
        relativePath: "media-jobs/job-download-1/artifact.bin",
        bytes: 512,
      },
    }),
    files: {
      relativePath: "media-jobs/job-download-1/artifact.bin",
      bytes: 512,
      completeMarker: false,
    },
  });
  assert.equal(pressure.phase, "failed-retryable");
  assert.equal(pressure.failureCode, "storage-pressure");
  assert.equal(pressure.artifact.kind, "partial");
});

test("a newer product generation fences a stale native journal", () => {
  const product = applyCommand(
    applyCommand(
      {
        ...createQueuedMediaJobSnapshot(intent()),
        phase: "canceled",
      },
      { kind: "retry", jobId: asMediaJobId("job-download-1") },
      later,
    ).snapshot,
    { kind: "recover", jobId: asMediaJobId("job-download-1") },
    later,
  ).snapshot;
  const stale = reconcileMediaJob({
    intent: product.intent,
    product,
    journal: journal(createQueuedMediaJobSnapshot(intent()), {
      generation: 1,
      phase: "running",
      serviceOwned: true,
    }),
    files: null,
  });
  assert.equal(stale.phase, "queued");
  assert.equal(stale.checkpoint.generation, 2);
});

test("completed plus a partial artifact is a legal recovered recording", () => {
  const snapshot = reconcileMediaJob({
    intent: recordingIntent(),
    product: createQueuedMediaJobSnapshot(recordingIntent()),
    journal: journal(createQueuedMediaJobSnapshot(recordingIntent()), {
      phase: "completed",
      serviceOwned: false,
      artifact: {
        kind: "partial",
        relativePath: "media-jobs/job-recording-1/artifact.bin",
        bytes: 100,
      },
    }),
    files: {
      relativePath: "media-jobs/job-recording-1/artifact.bin",
      bytes: 100,
      completeMarker: false,
    },
  });
  assert.equal(mediaJobSnapshotSchema.is(snapshot), true);
  assert.equal(snapshot.phase, "completed");
  assert.equal(snapshot.artifact.kind, "partial");
});

test("Activity projection keeps failed-retryable active and preserves readAt", () => {
  const snapshot = {
    ...createQueuedMediaJobSnapshot(intent()),
    phase: "failed-retryable",
    statusMessage: "Interrupted. Retry to continue.",
    failureCode: "interrupted",
  };
  const first = projectMediaJobActivity(snapshot, null, now);
  assert.equal(first.eventId, "job:job-download-1");
  assert.equal(first.job.state.kind, "active");
  const read = markActivityItemRead(first, later);
  const next = projectMediaJobActivity(
    {
      ...snapshot,
      phase: "completed",
      statusMessage: "Completed",
      failureCode: null,
    },
    read,
    later,
  );
  assert.equal(next.readAt, later);
  assert.equal(next.occurredAt, now);
  assert.equal(next.job.state.kind, "terminal");
  assert.equal(next.body, "Completed");
});

test("journal parse rejects out-of-range numeric timestamps instead of throwing", () => {
  const queued = createQueuedMediaJobSnapshot(intent());
  assert.doesNotThrow(() => {
    assert.equal(
      parseMediaJobNativeJournal({
        ...journal(queued),
        checkpoint: {
          ...queued.checkpoint,
          updatedAt: Number.MAX_VALUE,
        },
      }),
      null,
    );
  });
  assert.doesNotThrow(() => {
    assert.equal(
      parseMediaJobNativeJournal({
        ...journal(queued),
        checkpoint: {
          ...queued.checkpoint,
          updatedAt: 8.64e15 + 1,
        },
      }),
      null,
    );
  });
});

test("reconcile matches the complete durable intent", () => {
  const download = {
    ...createQueuedMediaJobSnapshot(intent()),
    phase: "running",
    progress: { transferredBytes: 4096, totalBytes: null, durationMs: 120 },
    statusMessage: "Running",
  };
  const recording = recordingIntent();
  const recovered = reconcileMediaJob({
    intent: recording,
    product: download,
    journal: null,
    files: null,
  });
  assert.equal(recovered.intent.kind, "recording");
  assert.equal(recovered.phase, "queued");
  assert.equal(recovered.progress.transferredBytes, 0);
});

test("reconcile retains the accepted journal generation when checkpoint is omitted", () => {
  const product = applyCommand(
    {
      ...createQueuedMediaJobSnapshot(intent()),
      phase: "canceled",
    },
    { kind: "retry", jobId: asMediaJobId("job-download-1") },
    later,
  ).snapshot;
  const accepted = reconcileMediaJob({
    intent: product.intent,
    product,
    journal: journal(product, {
      generation: 5,
      checkpoint: null,
      phase: "running",
      serviceOwned: true,
    }),
    files: null,
  });
  assert.equal(accepted.checkpoint.generation, 5);
  const stale = reconcileMediaJob({
    intent: product.intent,
    product: accepted,
    journal: journal(createQueuedMediaJobSnapshot(intent()), {
      generation: 2,
      checkpoint: null,
      phase: "paused",
      serviceOwned: false,
    }),
    files: null,
  });
  assert.equal(stale.checkpoint.generation, 5);
  assert.equal(stale.phase, "running");
});

test("journal parse treats a missing failureCode as null", () => {
  const { failureCode: _omitted, ...rest } = journal(
    createQueuedMediaJobSnapshot(intent()),
  );
  assert.equal(parseMediaJobNativeJournal(rest)?.failureCode, null);
});

test("journal parse accepts Expo host-object prototypes and numeric strings", () => {
  const onDevice = {
    jobId: "download-1789179090398",
    kind: "download",
    generation: "1",
    phase: "completed",
    checkpoint: Object.assign(Object.create({ expo: true }), {
      generation: 1,
      byteOffset: "65536",
      durationMs: 2048,
      updatedAt: "2026-09-12T02:11:35.939Z",
    }),
    artifact: Object.assign(Object.create({ expo: true }), {
      kind: "complete",
      relativePath: "media-jobs/download-1789179090398/artifact.bin",
      bytes: 65536,
    }),
    serviceOwned: false,
    statusMessage: "Completed",
    sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  };
  const hosted = Object.assign(Object.create({ expo: true }), onDevice);
  const parsed = parseMediaJobNativeJournal(hosted);
  assert.equal(parsed?.jobId, "download-1789179090398");
  assert.equal(parsed?.phase, "completed");
  assert.equal(parsed?.artifact.kind, "complete");
  assert.equal(parsed?.artifact.bytes, 65536);
  assert.equal(parsed?.failureCode, null);
  assert.equal(parsed?.checkpoint?.byteOffset, 65536);
});

test("journal parse keeps known fields when native adds sourceUri", () => {
  const parsed = parseMediaJobNativeJournal({
    ...journal(createQueuedMediaJobSnapshot(intent())),
    sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  });
  assert.equal(parsed?.jobId, "job-download-1");
  assert.equal(parsed?.failureCode, null);
});

test("boundary parse rejects extra fields and unknown commands", () => {
  const snapshot = createQueuedMediaJobSnapshot(intent());
  assert.equal(parseMediaJobSnapshot(snapshot), snapshot);
  assert.equal(parseMediaJobSnapshot({ ...snapshot, extra: true }), null);
  assert.deepEqual(
    parseMediaJobCommand({ kind: "cancel", jobId: "job-download-1" }),
    {
      kind: "cancel",
      jobId: "job-download-1",
    },
  );
  assert.equal(
    parseMediaJobCommand({ kind: "explode", jobId: "job-download-1" }),
    null,
  );
});
