import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetDownloadThroughputStoreForTests,
  THROUGHPUT_RING_CAPACITY,
  useDownloadThroughputStore,
  type ThroughputSeries,
} from "@/features/media-library/components/state/download-throughput-store";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";

const MIB = 1024 * 1024;
const START_MS = Date.parse("2026-07-31T12:00:00.000Z");

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "vod-1",
    kind: "video",
    platform: "twitch",
    sourceId: "123",
    title: "Friday Night Finals",
    channelName: "speedrunpro",
    status: "downloading",
    progress: { percent: null, transferredBytes: 0, totalBytes: null },
    destinationPath: "D:\\Videos\\Friday Night Finals.mp4",
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:00:00.000Z",
    ...overrides,
  };
}

function push(jobs: DownloadJob[], atMs: number): void {
  vi.setSystemTime(atMs);
  useDownloadThroughputStore
    .getState()
    .ingestQueueSnapshot({ jobs } satisfies DownloadQueueSnapshot);
}

function seriesOf(jobId = "vod-1"): ThroughputSeries {
  const series = useDownloadThroughputStore.getState().seriesByJobId[jobId];
  if (!series) throw new Error("Expected a tracked throughput series");
  return series;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START_MS);
  _resetDownloadThroughputStoreForTests();
});

afterEach(() => {
  _resetDownloadThroughputStoreForTests();
  vi.useRealTimers();
});

// Guards: the first closed bucket must produce the measured rate, not an EMA climbing out of zero.
// Guards: an unthrottled direct-MP4 tick stream must decimate to sample-interval cadence.
// Guards: a single raw spike must not become the recorded peak, which tracks the smoothed series.
// Guards: an ffmpeg remux restart rewinds the byte counter and must restart the curve instead of drawing a negative rate.
// Guards: the reported average must be total bytes over total elapsed time, not the mean of the per-bucket rates.
// Guards: a stalled transfer must freeze the wave tail rather than scroll floored samples across the row.
// Guards: idle queue wait and paused time must not be counted as transfer time, or the first sample and the completion average both read far below the sustained rate.
// Guards: a download that is measured and not moving must read as stalled, not as the idle "no data yet" state.
// Guards: queue pushes inside an open bucket must not notify subscribers.
// Guards: leaving the page must empty every tracked series.
describe("download throughput store", () => {
  it("seeds the first sample from the closed bucket rate", () => {
    push([downloadJob()], START_MS);
    push(
      [downloadJob({ progress: { percent: 1, transferredBytes: 2 * MIB, totalBytes: null } })],
      START_MS + 500
    );

    const series = seriesOf();
    expect(series.samples).toHaveLength(1);
    expect(series.samples[0]?.bytesPerSecond).toBe(4 * MIB);
    expect(series.smoothedBytesPerSecond).toBe(4 * MIB);
    expect(series.phase).toBe("active");
  });

  it("decimates a hundred hertz burst to sample-interval cadence", () => {
    push([downloadJob()], START_MS);
    for (let tick = 1; tick <= 200; tick += 1) {
      const atMs = START_MS + tick * 10;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: tick * 100_000, totalBytes: null },
          }),
        ],
        atMs
      );
    }

    const { samples } = seriesOf();
    expect(samples.length).toBeLessThanOrEqual(4);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.map((sample) => sample.atMs)).toEqual(
      [...samples.map((sample) => sample.atMs)].sort((left, right) => left - right)
    );
    expect(new Set(samples.map((sample) => sample.atMs)).size).toBe(samples.length);
  });

  it("keeps the peak on the smoothed series so one raw spike is not recorded", () => {
    push([downloadJob()], START_MS);
    for (let bucket = 1; bucket <= 5; bucket += 1) {
      const atMs = START_MS + bucket * 500;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * MIB, totalBytes: null },
          }),
        ],
        atMs
      );
    }

    const steady = seriesOf().peakBytesPerSecond;
    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 55 * MIB, totalBytes: null } })],
      START_MS + 3000
    );

    const spiked = seriesOf();
    expect(steady).toBeLessThanOrEqual(2 * MIB);
    expect(spiked.peakBytesPerSecond).toBe(
      Math.max(...spiked.samples.map((s) => s.bytesPerSecond))
    );
    expect(spiked.peakBytesPerSecond).toBeLessThan(50 * MIB);
  });

  it("restarts the series when a remux rewinds the byte counter", () => {
    push([downloadJob()], START_MS);
    for (let bucket = 1; bucket <= 3; bucket += 1) {
      const atMs = START_MS + bucket * 500;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * 4 * MIB, totalBytes: null },
          }),
        ],
        atMs
      );
    }
    expect(seriesOf().samples.length).toBe(3);

    push(
      [downloadJob({ progress: { percent: 0, transferredBytes: 64, totalBytes: null } })],
      START_MS + 2000
    );

    const restarted = seriesOf();
    expect(restarted.samples).toHaveLength(0);
    expect(restarted.smoothedBytesPerSecond).toBeNull();
    expect(restarted.peakBytesPerSecond).toBe(0);
    expect(restarted.phase).toBe("idle");

    push(
      [downloadJob({ progress: { percent: 1, transferredBytes: 64 + 2 * MIB, totalBytes: null } })],
      START_MS + 2500
    );
    const resumed = seriesOf();
    expect(resumed.samples).toHaveLength(1);
    expect(resumed.samples[0]?.bytesPerSecond).toBe(4 * MIB);
    expect(resumed.samples.every((sample) => sample.bytesPerSecond >= 0)).toBe(true);
  });

  it("averages total bytes over total elapsed time instead of the mean of the bucket rates", () => {
    push([downloadJob()], START_MS);
    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 1 * MIB, totalBytes: null } })],
      START_MS + 500
    );
    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 3 * MIB, totalBytes: null } })],
      START_MS + 1000
    );
    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 3 * MIB, totalBytes: null } })],
      START_MS + 1500
    );

    const series = seriesOf();
    expect(series.averageBytesPerSecond).toBe(2 * MIB);
    const meanOfRates =
      series.samples.reduce((total, sample) => total + sample.bytesPerSecond, 0) /
      series.samples.length;
    expect(series.averageBytesPerSecond).not.toBe(meanOfRates);
  });

  it("holds the wave tail and reports a stall once the transfer stops", () => {
    push([downloadJob()], START_MS);
    for (let bucket = 1; bucket <= 8; bucket += 1) {
      const atMs = START_MS + bucket * 500;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * 4 * MIB, totalBytes: null },
          }),
        ],
        atMs
      );
    }

    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 32 * MIB, totalBytes: null } })],
      START_MS + 4500
    );
    expect(seriesOf().phase).toBe("active");

    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 32 * MIB, totalBytes: null } })],
      START_MS + 5000
    );
    const stalled = seriesOf();
    expect(stalled.phase).toBe("stalled");
    expect(stalled.smoothedBytesPerSecond).toBe(16 * 1024);
    const frozenLength = stalled.samples.length;
    expect(stalled.samples.at(-1)?.bytesPerSecond).toBeGreaterThan(0);

    for (let bucket = 11; bucket <= 20; bucket += 1) {
      const atMs = START_MS + bucket * 500;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: 32 * MIB, totalBytes: null },
          }),
        ],
        atMs
      );
    }
    const stillStalled = seriesOf();
    expect(stillStalled.samples).toHaveLength(frozenLength);
    expect(stillStalled.phase).toBe("stalled");

    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 34 * MIB, totalBytes: null } })],
      START_MS + 10500
    );
    expect(seriesOf().phase).toBe("active");
  });

  it("does not notify subscribers for queue pushes inside an open bucket", () => {
    const notifications: unknown[] = [];
    const unsubscribe = useDownloadThroughputStore.subscribe(() => {
      notifications.push(useDownloadThroughputStore.getState().queue);
    });

    push([downloadJob()], START_MS);
    expect(notifications).toHaveLength(1);

    for (const offset of [100, 200, 300, 400]) {
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: offset * 1_000, totalBytes: null },
          }),
        ],
        START_MS + offset
      );
    }
    expect(notifications).toHaveLength(1);

    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 500_000, totalBytes: null } })],
      START_MS + 500
    );
    expect(notifications).toHaveLength(2);
    unsubscribe();
  });

  it("resets every tracked series when the page leaves", () => {
    push([downloadJob()], START_MS);
    push(
      [downloadJob({ progress: { percent: null, transferredBytes: 4 * MIB, totalBytes: null } })],
      START_MS + 500
    );
    expect(Object.keys(useDownloadThroughputStore.getState().seriesByJobId)).toEqual(["vod-1"]);

    useDownloadThroughputStore.getState().reset();

    const state = useDownloadThroughputStore.getState();
    expect(state.seriesByJobId).toEqual({});
    expect(state.queue).toBeNull();
    expect(state.loadError).toBeNull();
  });

  it("keeps at most one ring of samples for a long download", () => {
    push([downloadJob()], START_MS);
    for (let bucket = 1; bucket <= THROUGHPUT_RING_CAPACITY + 12; bucket += 1) {
      const atMs = START_MS + bucket * 500;
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * MIB, totalBytes: null },
          }),
        ],
        atMs
      );
    }

    const { samples } = seriesOf();
    expect(samples).toHaveLength(THROUGHPUT_RING_CAPACITY);
    expect(samples[0]?.atMs).toBe(START_MS + 13 * 500);
  });

  it("measures the first sample over the transfer window, not the queue wait before it", () => {
    // Queued for 30s. ffmpeg's first tick only opens the bucket, so the first closed bucket
    // measures 4 MiB across one 500ms tick of real transfer rather than 4 MiB across 30s of waiting.
    push([downloadJob({ status: "queued" })], START_MS);
    for (let tick = 0; tick <= 4; tick += 1) {
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: (tick + 1) * MIB, totalBytes: null },
          }),
        ],
        START_MS + 30_000 + tick * 500
      );
    }

    expect(seriesOf().samples[0]?.bytesPerSecond).toBe(2 * MIB);
  });

  it("averages over the transfer window, so queued and paused time does not deflate it", () => {
    const bucketBytes = 4 * MIB;
    const buckets = 20;
    push([downloadJob({ status: "queued" })], START_MS);
    for (let bucket = 1; bucket <= buckets; bucket += 1) {
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * bucketBytes, totalBytes: null },
          }),
        ],
        START_MS + 30_000 + bucket * 500
      );
    }
    const totalBytes = buckets * bucketBytes;
    push(
      [
        downloadJob({
          status: "completed",
          progress: { percent: 100, transferredBytes: totalBytes, totalBytes },
        }),
      ],
      START_MS + 40_000
    );

    const series = seriesOf();
    expect(series.phase).toBe("complete");
    expect(series.averageBytesPerSecond).toBe(8 * MIB);
  });

  it("reads a measured but motionless download as stalled, not as idle", () => {
    // The byte counter freezes partway through, which is the case a user most needs to notice.
    push([downloadJob()], START_MS);
    for (let bucket = 1; bucket <= 4; bucket += 1) {
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: bucket * MIB, totalBytes: null },
          }),
        ],
        START_MS + bucket * 500
      );
    }
    expect(seriesOf().phase).toBe("active");

    for (let bucket = 5; bucket <= 8; bucket += 1) {
      push(
        [
          downloadJob({
            progress: { percent: null, transferredBytes: 4 * MIB, totalBytes: null },
          }),
        ],
        START_MS + bucket * 500
      );
    }

    const series = seriesOf();
    expect(series.phase).toBe("stalled");
    expect(series.samples.at(-1)?.bytesPerSecond).toBeGreaterThan(0);
  });

  it("keeps a first bucket that has not closed yet in the idle state", () => {
    push([downloadJob()], START_MS);
    push(
      [
        downloadJob({
          progress: { percent: null, transferredBytes: MIB, totalBytes: null },
        }),
      ],
      START_MS + 200
    );

    expect(seriesOf().phase).toBe("idle");
    expect(seriesOf().smoothedBytesPerSecond).toBeNull();
  });
});
