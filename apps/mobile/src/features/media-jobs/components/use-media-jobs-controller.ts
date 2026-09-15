import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
  MEDIA_JOB_FIXTURE_RECORDING_COMPRESSED_URI,
  MEDIA_JOB_FIXTURE_RECORDING_STORAGE_PRESSURE_URI,
  MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI,
  MEDIA_JOB_HTTP_RANGE_PROOF_URI,
  asMediaJobId,
  isInFlightMediaJobPhase,
  type MediaJobCommand,
  type MediaJobCommandName,
  type MediaJobCommandResult,
  type MediaJobIntent,
  type MediaJobKind,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { useEffect, useRef, useState } from "react";

import type { MediaJobWorkflow } from "../capabilities/media-jobs";
import {
  MEDIA_JOB_COMMAND_BUSY,
  MEDIA_JOB_DELETED,
  MEDIA_JOB_EXPORT_CANCELLED,
  MEDIA_JOB_EXPORT_MISMATCH,
  MEDIA_JOB_EXPORT_VERIFIED,
  MEDIA_JOB_OPENED,
  MEDIA_JOB_RECOVERY_FAILED,
} from "../utils/media-job-labels";
import {
  createExclusiveGate,
  recoverInBackground,
  withUserLock,
} from "./media-jobs-controller-lock";

export { MEDIA_JOB_COMMAND_BUSY, MEDIA_JOB_RECOVERY_FAILED };

export interface MediaJobsViewModel {
  readonly busy: boolean;
  readonly jobs: readonly MediaJobSnapshot[];
  readonly selected: MediaJobSnapshot | null;
  readonly status: string | null;
}

export interface MediaJobsController {
  readonly apply: (command: MediaJobCommandName) => Promise<void>;
  readonly deleteJob: () => Promise<void>;
  readonly exportJob: () => Promise<void>;
  readonly model: MediaJobsViewModel;
  readonly openArtifact: () => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly startDownload: () => Promise<string>;
  readonly startHttpRange: () => Promise<string>;
  readonly startNetworkLoss: () => Promise<string>;
  readonly startRecording: () => Promise<string>;
  readonly startCompressedRecording: () => Promise<string>;
  readonly startRecordingStoragePressure: () => Promise<string>;
  readonly startStoragePressure: () => Promise<string>;
  readonly startWithIntent: (
    intent: MediaJobIntent,
    requestHeaders?: Readonly<Record<string, string>>,
  ) => Promise<string>;
}

export function useMediaJobsController(options: {
  readonly selectedJobId?: string | undefined;
  readonly workflow: MediaJobWorkflow;
}): MediaJobsController {
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<readonly MediaJobSnapshot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const recoverInFlight = useRef(false);
  const persistGate = useRef(createExclusiveGate());
  const userLock = useRef(false);
  const selected =
    jobs.find((job) => job.intent.jobId === options.selectedJobId) ?? null;

  const refresh = async () => {
    setJobs(await options.workflow.list());
  };

  useEffect(() => {
    let active = true;
    void recoverInBackground({
      active: () => active,
      persistGate: persistGate.current,
      recoverInFlight,
      setJobs,
      setStatus,
      userLock,
      workflow: options.workflow,
    });
    return () => {
      active = false;
    };
  }, [options.selectedJobId, options.workflow]);

  useEffect(() => {
    const inFlight = jobs.some(
      (job) =>
        job.service.kind === "owned" || isInFlightMediaJobPhase(job.phase),
    );
    if (!inFlight) return undefined;
    const timer = setInterval(() => {
      void recoverInBackground({
        persistGate: persistGate.current,
        recoverInFlight,
        setJobs,
        setStatus,
        userLock,
        workflow: options.workflow,
      });
    }, 700);
    return () => clearInterval(timer);
  }, [jobs, options.workflow]);

  const lockUser = async <T>(work: () => Promise<T>): Promise<T | null> => {
    const result = await withUserLock(
      persistGate.current,
      userLock,
      setBusy,
      work,
    );
    if (result.kind === "busy") {
      setStatus(MEDIA_JOB_COMMAND_BUSY);
      return null;
    }
    return result.value;
  };

  const startWithIntent = async (
    intent: MediaJobIntent,
    requestHeaders?: Readonly<Record<string, string>>,
  ) => {
    const started = await lockUser(async () => {
      const result = await options.workflow.start(intent, requestHeaders);
      if (result.kind === "rejected") setStatus(result.reason);
      await refresh();
      return intent.jobId;
    });
    return started ?? "";
  };

  const start = async (kind: MediaJobKind, sourceUri: string) => {
    return startWithIntent({
      schemaVersion: 1,
      jobId: asMediaJobId(`${kind}-${Date.now()}`),
      kind,
      sourceUri,
      createdAt: nowTimestamp(),
    });
  };

  const runSelected = async (
    work: (jobId: string) => Promise<string | null>,
  ) => {
    const selectedJobId = options.selectedJobId;
    if (!selectedJobId) return;
    await lockUser(async () => {
      const message = await work(selectedJobId);
      if (message) setStatus(message);
      await refresh();
    });
  };

  return {
    model: { busy, jobs, selected, status },
    apply: async (command) => {
      await runSelected(async (selectedJobId) => {
        const now = nowTimestamp();
        const result = await options.workflow.apply(
          applyPayload(command, asMediaJobId(selectedJobId), now),
          now,
        );
        return statusFromResult(result);
      });
    },
    deleteJob: async () => {
      await runSelected(async (jobId) => {
        const result = await options.workflow.delete(jobId, nowTimestamp());
        return result.kind === "rejected" ? result.reason : MEDIA_JOB_DELETED;
      });
    },
    exportJob: async () => {
      await runSelected(async (jobId) =>
        exportMessage(await options.workflow.exportJob(jobId)),
      );
    },
    openArtifact: async () => {
      await runSelected(async (jobId) => {
        const result = await options.workflow.openArtifact(jobId);
        return result.kind === "rejected" ? result.reason : MEDIA_JOB_OPENED;
      });
    },
    recover: async () => {
      await lockUser(async () => {
        try {
          setJobs(await options.workflow.recoverAll(nowTimestamp()));
        } catch {
          setStatus(MEDIA_JOB_RECOVERY_FAILED);
        }
      });
    },
    refresh,
    startDownload: () => start("download", MEDIA_JOB_FIXTURE_DOWNLOAD_URI),
    startHttpRange: () => start("download", MEDIA_JOB_HTTP_RANGE_PROOF_URI),
    startNetworkLoss: () => start("download", MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI),
    startRecording: () => start("recording", MEDIA_JOB_FIXTURE_RECORDING_URI),
    startCompressedRecording: () =>
      start("recording", MEDIA_JOB_FIXTURE_RECORDING_COMPRESSED_URI),
    startRecordingStoragePressure: () =>
      start("recording", MEDIA_JOB_FIXTURE_RECORDING_STORAGE_PRESSURE_URI),
    startStoragePressure: () =>
      start("download", MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI),
    startWithIntent,
  };
}

function nowTimestamp(): ReturnType<typeof toSerializedTimestamp> {
  return toSerializedTimestamp(new Date().toISOString());
}

function statusFromResult(result: MediaJobCommandResult): string {
  return result.kind === "rejected" ? result.reason : result.snapshot.statusMessage;
}

function applyPayload(
  command: MediaJobCommandName,
  jobId: ReturnType<typeof asMediaJobId>,
  createdAt: ReturnType<typeof toSerializedTimestamp>,
): MediaJobCommand {
  if (command !== "start") return { kind: command, jobId };
  return {
    kind: "start",
    intent: {
      schemaVersion: 1,
      jobId,
      kind: "download",
      sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
      createdAt,
    },
  };
}

function exportMessage(
  result: Awaited<ReturnType<MediaJobWorkflow["exportJob"]>>,
): string {
  if (result.kind === "cancelled") return MEDIA_JOB_EXPORT_CANCELLED;
  if (result.kind === "rejected") return result.reason;
  if (result.matched) return MEDIA_JOB_EXPORT_VERIFIED;
  return MEDIA_JOB_EXPORT_MISMATCH;
}
