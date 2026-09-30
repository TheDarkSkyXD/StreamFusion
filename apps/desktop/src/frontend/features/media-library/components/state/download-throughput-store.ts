import { create } from "zustand";

import { getDownloadController } from "@/features/media-library/composition/download-controller";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";

/** 2 Hz is what download managers sample at, and ffmpeg already reports at roughly this rate. */
export const THROUGHPUT_SAMPLE_INTERVAL_MS = 500;
/** Twenty-four seconds of history at that interval. */
export const THROUGHPUT_RING_CAPACITY = 48;
/** 2 / (9 + 1), the smoothing window download managers ship. */
export const THROUGHPUT_EMA_ALPHA = 0.2;
export const THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND = 16 * 1024;
export const SHARED_MAX_FLOOR_BYTES_PER_SECOND = 64 * 1024;

export type ThroughputPhase = "idle" | "active" | "stalled" | "complete";

export interface ThroughputSample {
  readonly atMs: number;
  readonly bytesPerSecond: number;
}

export interface ThroughputSeries {
  readonly jobId: string;
  readonly phase: ThroughputPhase;
  readonly samples: readonly ThroughputSample[];
  readonly smoothedBytesPerSecond: number | null;
  readonly peakBytesPerSecond: number;
  readonly averageBytesPerSecond: number | null;
  readonly estimatedSecondsRemaining: number | null;
}

export type DownloadQueueLoadError = "unavailable" | "failed";

interface JobTracking {
  phase: ThroughputPhase;
  samples: ThroughputSample[];
  smoothed: number | null;
  peak: number;
  bucketOpenedAtMs: number;
  bucketOpenedBytes: number;
  baselineBytes: number;
  baselineAtMs: number;
  lastBytes: number;
  lastAtMs: number;
  quietBuckets: number;
  wasDownloading: boolean;
}

interface DownloadThroughputState {
  queue: DownloadQueueSnapshot | null;
  loadError: DownloadQueueLoadError | null;
  seriesByJobId: Readonly<Record<string, ThroughputSeries>>;
  ingestQueueSnapshot: (snapshot: DownloadQueueSnapshot) => void;
  reload: () => void;
  subscribe: () => () => void;
  reset: () => void;
}

const trackingByJobId = new Map<string, JobTracking>();
let subscriberCount = 0;
let releaseQueueSubscription: (() => void) | undefined;
let pushVersion = 0;

function resolvePhase(job: DownloadJob, smoothed: number | null): ThroughputPhase {
  if (job.status === "completed") return "complete";
  if (job.status !== "downloading") return "idle";
  // A null smoothed value means no bucket has closed yet, which is the only true idle state.
  // A download that has been measured and is not moving is stalled, and must not read as idle.
  if (smoothed === null) return "idle";
  if (smoothed <= THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND) return "stalled";
  return "active";
}

function startTracking(
  transferredBytes: number,
  nowMs: number,
  wasDownloading: boolean
): JobTracking {
  return {
    phase: "idle",
    samples: [],
    smoothed: null,
    peak: 0,
    bucketOpenedAtMs: nowMs,
    bucketOpenedBytes: transferredBytes,
    baselineBytes: transferredBytes,
    baselineAtMs: nowMs,
    lastBytes: transferredBytes,
    lastAtMs: nowMs,
    quietBuckets: 0,
    wasDownloading,
  };
}

/**
 * Rate and average are measured over the window where bytes actually moved. A job that waited in
 * the queue, or sat paused, has to drop that idle span or the first sample and the completion
 * average both read far below the transfer rate the engine is actually sustaining. Wave history
 * survives the re-anchor because the curve is still about the same transfer.
 */
function anchorToTransferStart(previous: JobTracking, transferredBytes: number, nowMs: number) {
  return {
    ...previous,
    bucketOpenedAtMs: nowMs,
    bucketOpenedBytes: transferredBytes,
    baselineBytes: transferredBytes,
    baselineAtMs: nowMs,
    quietBuckets: 0,
  };
}

/**
 * A remux restart rewinds the byte counter to zero, so the curve restarts instead of drawing a
 * negative rate between two unrelated remuxes of different containers.
 */
function isByteCounterRestart(previous: JobTracking, transferredBytes: number): boolean {
  return transferredBytes < previous.lastBytes;
}

function advanceSmoothed(previous: JobTracking, rawRate: number, nowMs: number): JobTracking {
  const fed = Math.max(rawRate, THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND);
  const decayed =
    previous.smoothed === null
      ? fed
      : previous.smoothed + THROUGHPUT_EMA_ALPHA * (fed - previous.smoothed);
  const quietBuckets =
    rawRate <= THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND ? previous.quietBuckets + 1 : 0;

  // A geometric decay toward the floor asymptotes without ever crossing it, so two quiet buckets
  // settle onto the floor. One quiet bucket is a closed TCP window, not a stalled transfer.
  const smoothed = quietBuckets > 1 ? THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND : decayed;

  if (smoothed <= THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND) {
    // Hold the tail: appending floored samples would scroll a flat line across the row.
    return { ...previous, smoothed, quietBuckets };
  }

  const samples = [...previous.samples, { atMs: nowMs, bytesPerSecond: smoothed }];
  if (samples.length > THROUGHPUT_RING_CAPACITY) samples.shift();

  return {
    ...previous,
    samples,
    smoothed,
    peak: Math.max(previous.peak, smoothed),
    quietBuckets,
  };
}

function trackJob(
  job: DownloadJob,
  previous: JobTracking | undefined,
  nowMs: number
): { tracking: JobTracking; changed: boolean } {
  const transferredBytes = job.progress.transferredBytes;
  const downloading = job.status === "downloading";
  if (!previous) {
    return {
      tracking: startTracking(transferredBytes, nowMs, downloading),
      changed: true,
    };
  }

  const restarted = isByteCounterRestart(previous, transferredBytes);
  const transferStarted = downloading && !previous.wasDownloading;
  const reanchored = transferStarted
    ? anchorToTransferStart(previous, transferredBytes, nowMs)
    : previous;
  const base = restarted
    ? startTracking(transferredBytes, nowMs, downloading)
    : reanchored;

  const elapsedMs = nowMs - base.bucketOpenedAtMs;
  const bucketClosed = elapsedMs >= THROUGHPUT_SAMPLE_INTERVAL_MS;
  const next =
    bucketClosed && downloading
      ? advanceSmoothed(
          base,
          elapsedMs > 0 ? (transferredBytes - base.bucketOpenedBytes) / (elapsedMs / 1000) : 0,
          nowMs
        )
      : base;

  const tracking: JobTracking = {
    ...next,
    phase: resolvePhase(job, next.smoothed),
    bucketOpenedAtMs: bucketClosed ? nowMs : base.bucketOpenedAtMs,
    bucketOpenedBytes: bucketClosed ? transferredBytes : base.bucketOpenedBytes,
    lastBytes: transferredBytes,
    lastAtMs: nowMs,
    wasDownloading: downloading,
  };

  const changed = restarted || transferStarted || (bucketClosed && downloading) || tracking.phase !== previous.phase;
  return { tracking, changed };
}

function averageRate(tracking: JobTracking): number | null {
  const elapsedSeconds = (tracking.lastAtMs - tracking.baselineAtMs) / 1000;
  if (elapsedSeconds <= 0) return null;
  return (tracking.lastBytes - tracking.baselineBytes) / elapsedSeconds;
}

/**
 * A count-up needs a second of evidence, and a stalled transfer has no finish line worth naming.
 * Two bounds matter: aria2 and qBittorrent both refuse an ETA below their stall threshold, and an
 * HLS row carries no total bytes, so its estimate has to come from progress percent over elapsed
 * transfer time instead. Percent near zero is discarded rather than divided through, because the
 * first bucket of a long VOD would otherwise report a finish time in the thousands of hours.
 */
const MIN_ETA_SAMPLE_MS = 1_000;
const MIN_ETA_PERCENT = 1;

function estimateSecondsRemaining(job: DownloadJob, tracking: JobTracking): number | null {
  if (tracking.phase !== "active") return null;
  if (tracking.lastAtMs - tracking.baselineAtMs < MIN_ETA_SAMPLE_MS) return null;

  const rate = tracking.smoothed;
  if (rate === null || rate <= THROUGHPUT_STALL_FLOOR_BYTES_PER_SECOND) return null;

  const { percent, totalBytes, transferredBytes } = job.progress;
  if (totalBytes !== null && totalBytes > transferredBytes) {
    return (totalBytes - transferredBytes) / rate;
  }

  if (percent !== null && percent >= MIN_ETA_PERCENT && percent < 100) {
    const elapsedSeconds = (tracking.lastAtMs - tracking.baselineAtMs) / 1000;
    const remainingFraction = (100 - percent) / percent;
    return elapsedSeconds * remainingFraction;
  }

  return null;
}

function buildSeries(jobs: readonly DownloadJob[]): Record<string, ThroughputSeries> {
  const series: Record<string, ThroughputSeries> = {};
  for (const job of jobs) {
    const tracking = trackingByJobId.get(job.id);
    if (!tracking) continue;
    series[job.id] = {
      jobId: job.id,
      phase: tracking.phase,
      samples: tracking.samples,
      smoothedBytesPerSecond: tracking.smoothed,
      peakBytesPerSecond: tracking.peak,
      averageBytesPerSecond: averageRate(tracking),
      estimatedSecondsRemaining: estimateSecondsRemaining(job, tracking),
    };
  }
  return series;
}

function applySnapshot(snapshot: DownloadQueueSnapshot, nowMs: number, force: boolean): boolean {
  let changed = trackingByJobId.size !== snapshot.jobs.length;
  const next = new Map<string, JobTracking>();
  for (const job of snapshot.jobs) {
    const result = trackJob(job, trackingByJobId.get(job.id), nowMs);
    if (result.changed) changed = true;
    next.set(job.id, result.tracking);
  }
  for (const jobId of trackingByJobId.keys()) {
    if (!next.has(jobId)) changed = true;
  }

  trackingByJobId.clear();
  for (const [jobId, tracking] of next) trackingByJobId.set(jobId, tracking);

  if (!changed && !force) return false;
  useDownloadThroughputStore.setState({
    queue: snapshot,
    loadError: null,
    seriesByJobId: buildSeries(snapshot.jobs),
  });
  return true;
}

function loadQueue(): void {
  const api = getDownloadController();
  if (!api) {
    useDownloadThroughputStore.setState({ loadError: "unavailable" });
    return;
  }

  const versionAtStart = pushVersion;
  void api.getQueue().then(
    (snapshot) => {
      if (subscriberCount === 0 || pushVersion !== versionAtStart) return;
      applySnapshot(snapshot, Date.now(), true);
    },
    () => {
      if (subscriberCount === 0 || pushVersion !== versionAtStart) return;
      useDownloadThroughputStore.setState({ loadError: "failed" });
    }
  );
}

export const useDownloadThroughputStore = create<DownloadThroughputState>()((set, get) => ({
  queue: null,
  loadError: null,
  seriesByJobId: {},

  ingestQueueSnapshot: (snapshot) => {
    pushVersion += 1;
    applySnapshot(snapshot, Date.now(), false);
  },

  reload: () => {
    set({ queue: null, loadError: null });
    loadQueue();
  },

  subscribe: () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      const api = getDownloadController();
      if (!api) {
        useDownloadThroughputStore.setState({ loadError: "unavailable" });
      } else {
        releaseQueueSubscription = api.onQueueChanged((snapshot) => {
          get().ingestQueueSnapshot(snapshot);
        });
        loadQueue();
      }
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount > 0) return;
      releaseQueueSubscription?.();
      releaseQueueSubscription = undefined;
    };
  },

  reset: () => {
    pushVersion += 1;
    trackingByJobId.clear();
    useDownloadThroughputStore.setState({ queue: null, loadError: null, seriesByJobId: {} });
  },
}));

export function _resetDownloadThroughputStoreForTests(): void {
  releaseQueueSubscription?.();
  releaseQueueSubscription = undefined;
  subscriberCount = 0;
  pushVersion = 0;
  trackingByJobId.clear();
  useDownloadThroughputStore.setState({ queue: null, loadError: null, seriesByJobId: {} });
}
