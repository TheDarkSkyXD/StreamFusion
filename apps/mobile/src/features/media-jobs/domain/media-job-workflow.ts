import {
  applyCommand,
  asMediaJobId,
  projectMediaJobActivity,
  reconcileMediaJob,
  type MediaJobCommand,
  type MediaJobCommandResult,
  type MediaJobFileEvidence,
  type MediaJobIntent,
  type MediaJobNativeJournal,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import {
  toSerializedTimestamp,
  type ActivityItem,
} from "@streamfusion/core/activity";

import type { AndroidMediaJobsContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import type {
  MediaJobRepository,
  MediaJobWorkflow,
} from "../capabilities/media-jobs";

export function createMediaJobWorkflow(options: {
  readonly activity: ActivityRepository;
  readonly native: AndroidMediaJobsContractPort;
  readonly product: MediaJobRepository;
}): MediaJobWorkflow {
  return {
    apply: (command, nowIso) => applyJobCommand(options, command, nowIso),
    list: () => options.product.list(),
    recoverAll: (nowIso) => recoverAllJobs(options, nowIso),
    start: (intent) =>
      applyJobCommand(options, { kind: "start", intent }, intent.createdAt),
  };
}

async function applyJobCommand(
  options: {
    readonly activity: ActivityRepository;
    readonly native: AndroidMediaJobsContractPort;
    readonly product: MediaJobRepository;
  },
  command: MediaJobCommand,
  nowIso: string,
): Promise<MediaJobCommandResult> {
  const now = toSerializedTimestamp(nowIso);
  const jobId = command.kind === "start" ? command.intent.jobId : command.jobId;
  const product = await options.product.get(jobId);
  const local = applyCommand(product, command, now);
  if (local.kind === "rejected") return local;
  if (local.kind === "ignored" && command.kind !== "recover") return local;
  const native = await invokeNative(options.native, command);
  if (native.kind !== "completed") {
    const reason = native.failure.diagnostic;
    if (local.kind === "ok") {
      await persistProjection(
        options,
        { ...local.snapshot, statusMessage: reason },
        nowIso,
      );
    }
    return { kind: "rejected", reason };
  }
  if (native.value.kind === "missing") {
    return { kind: "rejected", reason: "Media Job does not exist." };
  }
  const intent =
    command.kind === "start" ? command.intent : local.snapshot.intent;
  const snapshot = reconcileMediaJob({
    intent,
    product: await options.product.get(jobId),
    journal: native.value.journal,
    files: native.value.files,
  });
  await persistProjection(options, snapshot, nowIso);
  return local.kind === "ignored"
    ? { kind: "ignored", snapshot }
    : { kind: "ok", snapshot };
}

async function recoverAllJobs(
  options: {
    readonly activity: ActivityRepository;
    readonly native: AndroidMediaJobsContractPort;
    readonly product: MediaJobRepository;
  },
  nowIso: string,
): Promise<readonly MediaJobSnapshot[]> {
  const native = await options.native.recoverJobs();
  const productJobs = await options.product.list();
  if (native.kind !== "completed") {
    return recoverListedJobs(options, productJobs, nowIso);
  }
  const journals = new Map<string, MediaJobNativeJournal>();
  const files = new Map<string, MediaJobFileEvidence | null>();
  for (const result of native.value) {
    if (result.kind !== "record") continue;
    journals.set(result.journal.jobId, result.journal);
    files.set(result.journal.jobId, result.files);
  }
  const ids = new Set([
    ...productJobs.map((job) => job.intent.jobId),
    ...journals.keys(),
  ]);
  const recovered: MediaJobSnapshot[] = [];
  for (const id of ids) {
    const product = productJobs.find((job) => job.intent.jobId === id) ?? null;
    const journal = journals.get(id) ?? null;
    if (!product && !journal) continue;
    const intent = product?.intent ?? intentFromJournal(journal!);
    const snapshot = reconcileMediaJob({
      intent,
      product,
      journal,
      files: files.get(id) ?? null,
    });
    await persistProjection(options, snapshot, nowIso);
    recovered.push(snapshot);
  }
  return recovered;
}

async function persistProjection(
  options: {
    readonly activity: ActivityRepository;
    readonly product: MediaJobRepository;
  },
  snapshot: MediaJobSnapshot,
  nowIso: string,
): Promise<void> {
  await options.product.put(snapshot);
  const existing =
    (await options.activity.list("jobs")).find(
      (item): item is Extract<ActivityItem, { kind: "job" }> =>
        item.kind === "job" && item.job.id === snapshot.intent.jobId,
    ) ?? null;
  await options.activity.record(
    projectMediaJobActivity(snapshot, existing, toSerializedTimestamp(nowIso)),
  );
}

async function recoverListedJobs(
  options: {
    readonly activity: ActivityRepository;
    readonly native: AndroidMediaJobsContractPort;
    readonly product: MediaJobRepository;
  },
  productJobs: readonly MediaJobSnapshot[],
  nowIso: string,
): Promise<readonly MediaJobSnapshot[]> {
  const recovered: MediaJobSnapshot[] = [];
  for (const product of productJobs) {
    const native = await options.native.getRecoverableJob(product.intent.jobId);
    if (native.kind !== "completed" || native.value.kind !== "record") {
      await persistProjection(options, product, nowIso);
      recovered.push(product);
      continue;
    }
    const snapshot = reconcileMediaJob({
      intent: product.intent,
      product,
      journal: native.value.journal,
      files: native.value.files,
    });
    await persistProjection(options, snapshot, nowIso);
    recovered.push(snapshot);
  }
  return recovered;
}

function intentFromJournal(journal: MediaJobNativeJournal): MediaJobIntent {
  return {
    schemaVersion: 1,
    jobId: asMediaJobId(journal.jobId),
    kind: journal.kind,
    sourceUri: `streamfusion-recovered://${journal.kind}`,
    createdAt:
      journal.checkpoint?.updatedAt ??
      toSerializedTimestamp(new Date(0).toISOString()),
  };
}

async function invokeNative(
  native: AndroidMediaJobsContractPort,
  command: MediaJobCommand,
) {
  switch (command.kind) {
    case "start":
      return native.startRecoverableJob({
        jobId: command.intent.jobId,
        kind: command.intent.kind,
        sourceUri: command.intent.sourceUri,
      });
    case "pause":
      return native.pauseRecoverableJob(command.jobId);
    case "resume":
      return native.resumeRecoverableJob(command.jobId);
    case "cancel":
      return native.cancelRecoverableJob(command.jobId);
    case "retry":
      return native.retryRecoverableJob(command.jobId);
    case "finalize":
      return native.finalizeRecoverableJob(command.jobId);
    case "recover":
      return native.getRecoverableJob(command.jobId);
  }
}
