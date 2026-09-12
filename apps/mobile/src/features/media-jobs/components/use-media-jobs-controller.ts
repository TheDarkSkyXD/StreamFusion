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
import { useEffect, useState } from "react";

import type { MediaJobWorkflow } from "../capabilities/media-jobs";

export interface MediaJobsViewModel {
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
  const [jobs, setJobs] = useState<readonly MediaJobSnapshot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const selected =
    jobs.find((job) => job.intent.jobId === options.selectedJobId) ?? null;

  const refresh = async () => {
    setJobs(await options.workflow.list());
  };

  useEffect(() => {
    void options.workflow
      .recoverAll(toSerializedTimestamp(new Date().toISOString()))
      .then(setJobs);
  }, [options.selectedJobId, options.workflow]);

  useEffect(() => {
    const inFlight = jobs.some((job) =>
      ["queued", "preparing", "running", "pausing", "finalizing"].includes(
        job.phase,
      ),
    );
    if (!inFlight) return undefined;
    const timer = setInterval(() => {
      void options.workflow
        .recoverAll(toSerializedTimestamp(new Date().toISOString()))
        .then(setJobs);
    }, 700);
    return () => clearInterval(timer);
  }, [jobs, options.workflow]);

  const start = async (kind: MediaJobKind, sourceUri: string) => {
    const createdAt = toSerializedTimestamp(new Date().toISOString());
    const jobId = asMediaJobId(`${kind}-${Date.now()}`);
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
  };

  return {
    model: { jobs, selected, status },
    apply: async (command) => {
      if (!options.selectedJobId) return;
      const jobId = asMediaJobId(options.selectedJobId);
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
    recover: async () => {
      setJobs(
        await options.workflow.recoverAll(
          toSerializedTimestamp(new Date().toISOString()),
        ),
      );
    },
    refresh,
    startDownload: () => start("download", MEDIA_JOB_FIXTURE_DOWNLOAD_URI),
    startRecording: () => start("recording", MEDIA_JOB_FIXTURE_RECORDING_URI),
    startStoragePressure: () =>
      start("download", MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI),
  };
}
