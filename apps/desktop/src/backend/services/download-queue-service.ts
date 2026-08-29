import type { DownloadJob, DownloadProgress, DownloadQueueSnapshot } from "@shared/download-types";
import { storageService } from "./storage-service";

export interface DownloadQueueStorage {
  getDownloadQueue(): DownloadQueueSnapshot;
  saveDownloadQueue(snapshot: DownloadQueueSnapshot): void;
}

export interface DownloadQueueService {
  getQueue(): DownloadQueueSnapshot;
  enqueue(input: EnqueueDownloadJobInput): DownloadJob;
  start(id: string, at?: string): DownloadJob | null;
  pause(id: string, at?: string): DownloadJob | null;
  wait(id: string, at?: string): DownloadJob | null;
  resume(id: string, at?: string): DownloadJob | null;
  cancel(id: string, at?: string): DownloadJob | null;
  retry(id: string, at?: string): DownloadJob | null;
  complete(id: string, at?: string): DownloadJob | null;
  fail(id: string, error: string, at?: string): DownloadJob | null;
  updateTarget(
    id: string,
    target: Partial<
      Pick<
        DownloadJob,
        | "destinationPath"
        | "thumbnailUrl"
        | "qualityLabel"
        | "outputFormat"
        | "partial"
        | "retryable"
        | "statusMessage"
        | "nextRetryAt"
      >
    >,
    at?: string
  ): DownloadJob | null;
  remove(id: string): boolean;
  updateProgress(id: string, progress: DownloadProgress, at?: string): DownloadJob | null;
  subscribe(listener: (snapshot: DownloadQueueSnapshot) => void): () => void;
}

const ACTIVE_STATUSES = new Set<DownloadJob["status"]>(["downloading"]);

export type EnqueueDownloadJobInput = Pick<
  DownloadJob,
  "kind" | "platform" | "sourceId" | "title" | "channelName" | "destinationPath"
> &
  Partial<Pick<DownloadJob, "thumbnailUrl" | "qualityLabel" | "source">>;

function defaultCreateId(): string {
  return `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function normalizeHydratedJob(job: DownloadJob): DownloadJob {
  if (!ACTIVE_STATUSES.has(job.status)) return job;
  return {
    ...job,
    status: "paused",
    progress: { ...job.progress, bytesPerSecond: null },
    error: job.error ?? "Paused after StreamFusion restarted",
  };
}

function withDerivedSpeed(
  previous: DownloadJob,
  progress: DownloadProgress,
  at: string
): DownloadProgress {
  if (progress.bytesPerSecond !== undefined) return progress;

  const previousTime = Date.parse(previous.updatedAt);
  const nextTime = Date.parse(at);
  const elapsedSeconds = (nextTime - previousTime) / 1000;
  const byteDelta = progress.transferredBytes - previous.progress.transferredBytes;

  return {
    ...progress,
    bytesPerSecond: elapsedSeconds > 0 && byteDelta > 0 ? byteDelta / elapsedSeconds : null,
  };
}

export function createDownloadQueueService({
  storage,
  createId = defaultCreateId,
  now = defaultNow,
}: {
  storage: DownloadQueueStorage;
  createId?: () => string;
  now?: () => string;
}): DownloadQueueService {
  const listeners = new Set<(snapshot: DownloadQueueSnapshot) => void>();
  let queue: DownloadQueueSnapshot = {
    jobs: storage
      .getDownloadQueue()
      .jobs.filter((job) => (job.kind as string) !== "stream-recording")
      .map(normalizeHydratedJob),
  };

  function save(next: DownloadQueueSnapshot): void {
    queue = next;
    storage.saveDownloadQueue(queue);
    for (const listener of listeners) {
      listener(queue);
    }
  }

  function updateJob(id: string, updater: (job: DownloadJob) => DownloadJob): DownloadJob | null {
    let updatedJob: DownloadJob | null = null;
    const jobs = queue.jobs.map((job) => {
      if (job.id !== id) return job;
      updatedJob = updater(job);
      return updatedJob;
    });
    if (!updatedJob) return null;
    save({ jobs });
    return updatedJob;
  }

  save(queue);

  return {
    getQueue: () => queue,
    enqueue: (input) => {
      if ((input.kind as string) === "stream-recording") {
        throw new Error("Stream Recording state does not belong in Downloads");
      }
      const timestamp = now();
      const job: DownloadJob = {
        ...input,
        id: createId(),
        status: "queued",
        progress: { percent: 0, transferredBytes: 0, totalBytes: null },
        createdAt: timestamp,
        updatedAt: timestamp,
        error: null,
      };
      save({ jobs: [...queue.jobs, job] });
      return job;
    },
    start: (id, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        status: "downloading",
        updatedAt: at,
        error: null,
      }));
    },
    pause: (id, at = now()) => {
      return updateJob(id, (job) => ({ ...job, status: "paused", updatedAt: at }));
    },
    wait: (id, at = now()) => {
      return updateJob(id, (job) => ({ ...job, status: "waiting", updatedAt: at }));
    },
    resume: (id, at = now()) => {
      return updateJob(id, (job) => ({ ...job, status: "queued", updatedAt: at }));
    },
    cancel: (id, at = now()) => {
      return updateJob(id, (job) => ({ ...job, status: "cancelled", updatedAt: at }));
    },
    retry: (id, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        status: "queued",
        updatedAt: at,
        error: null,
      }));
    },
    complete: (id, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        status: "completed",
        progress: {
          percent: 100,
          transferredBytes: job.progress.totalBytes ?? job.progress.transferredBytes,
          totalBytes: job.progress.totalBytes,
          bytesPerSecond: null,
        },
        updatedAt: at,
        error: null,
      }));
    },
    fail: (id, error, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        status: "failed",
        updatedAt: at,
        error,
      }));
    },
    updateTarget: (id, target, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        ...target,
        updatedAt: at,
      }));
    },
    remove: (id) => {
      const nextJobs = queue.jobs.filter((job) => job.id !== id);
      if (nextJobs.length === queue.jobs.length) return false;
      save({ jobs: nextJobs });
      return true;
    },
    updateProgress: (id, progress, at = now()) => {
      return updateJob(id, (job) => ({
        ...job,
        progress: withDerivedSpeed(job, progress, at),
        updatedAt: at,
      }));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let downloadQueueService: DownloadQueueService | null = null;

export function getDownloadQueueService(): DownloadQueueService {
  if (!downloadQueueService) {
    downloadQueueService = createDownloadQueueService({ storage: storageService });
  }
  return downloadQueueService;
}
