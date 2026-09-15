import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
  MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI,
  asMediaJobId,
  type MediaJobCommandName,
  type MediaJobKind,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { useEffect, useRef, useState } from "react";

import type { MediaJobWorkflow } from "../capabilities/media-jobs";
import {
  createExclusiveGate,
  recoverInBackground,
  withUserLock,
  MEDIA_JOB_RECOVERY_FAILED,
} from "./media-jobs-controller-lock";

export { MEDIA_JOB_RECOVERY_FAILED };
export const MEDIA_JOB_COMMAND_BUSY =
  "A Media Job command is already in progress.";

export interface MediaJobsViewModel {
  readonly busy: boolean;
  readonly jobs: readonly MediaJobSnapshot[];
  readonly selected: MediaJobSnapshot | null;
  readonly status: string | null;
}

export function useMediaJobsController(options: {
  readonly selectedJobId?: string | undefined;
  readonly workflow: MediaJobWorkflow;
}): {
  readonly apply: (command: MediaJobCommandName) => Promise<void>;
  readonly model: MediaJobsViewModel;
  readonly recover: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly startDownload: () => Promise<string>;
  readonly startRecording: () => Promise<string>;
  readonly startStoragePressure: () => Promise<string>;
} {
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
    const inFlight = jobs.some((job) =>
      ["queued", "preparing", "running", "pausing", "finalizing"].includes(
        job.phase,
      ),
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

  const start = async (kind: MediaJobKind, sourceUri: string) => {
    const createdAt = toSerializedTimestamp(new Date().toISOString());
    const jobId = asMediaJobId(`${kind}-${Date.now()}`);
    const started = await withUserLock(
      persistGate.current,
      userLock,
      setBusy,
      async () => {
        const result = await options.workflow.start({
          schemaVersion: 1,
          jobId,
          kind,
          sourceUri,
          createdAt,
        });
        setStatus(
          result.kind === "rejected"
            ? result.reason
            : result.snapshot.statusMessage,
        );
        await refresh();
        return jobId;
      },
    );
    if (started.kind === "busy") {
      setStatus(MEDIA_JOB_COMMAND_BUSY);
      return "";
    }
    return started.value;
  };

  return {
    model: { busy, jobs, selected, status },
    apply: async (command) => {
      const selectedJobId = options.selectedJobId;
      if (!selectedJobId) return;
      const applied = await withUserLock(
        persistGate.current,
        userLock,
        setBusy,
        async () => {
          const jobId = asMediaJobId(selectedJobId);
          const now = toSerializedTimestamp(new Date().toISOString());
          const result = await options.workflow.apply(
            command === "start"
              ? {
                  kind: "start",
                  intent: {
                    schemaVersion: 1,
                    jobId,
                    kind: "download",
                    sourceUri: MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
                    createdAt: now,
                  },
                }
              : { kind: command, jobId },
            now,
          );
          setStatus(
            result.kind === "rejected"
              ? result.reason
              : result.snapshot.statusMessage,
          );
          await refresh();
        },
      );
      if (applied.kind === "busy") setStatus(MEDIA_JOB_COMMAND_BUSY);
    },
    recover: async () => {
      const recovered = await withUserLock(
        persistGate.current,
        userLock,
        setBusy,
        async () => {
          try {
            setJobs(
              await options.workflow.recoverAll(
                toSerializedTimestamp(new Date().toISOString()),
              ),
            );
          } catch {
            setStatus(MEDIA_JOB_RECOVERY_FAILED);
          }
        },
      );
      if (recovered.kind === "busy") setStatus(MEDIA_JOB_COMMAND_BUSY);
    },
    refresh,
    startDownload: () => start("download", MEDIA_JOB_FIXTURE_DOWNLOAD_URI),
    startRecording: () => start("recording", MEDIA_JOB_FIXTURE_RECORDING_URI),
    startStoragePressure: () =>
      start("download", MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI),
  };
}
