export interface FrameSummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  over16Ms: number;
  over33Ms: number;
  over50Ms: number;
}

export interface PerformanceSnapshot {
  name: string | null;
  frames: FrameSummary;
  longTasks: LongTaskSample[];
  video: VideoSummary;
  routes: RouteTiming[];
}

export interface RouteTiming {
  hash: string;
  durationMs: number;
}

export interface LongTaskSample {
  startTime: number;
  duration: number;
}

export type VideoEventName = "loadedmetadata" | "canplay" | "playing" | "waiting" | "stalled";

export interface VideoQualitySample {
  totalVideoFrames: number;
  droppedVideoFrames: number;
}

export interface VideoSummary {
  milestones: Partial<Record<`${VideoEventName}Ms`, number>>;
  totalFrames: number;
  droppedFrames: number;
  droppedFrameRatio: number;
}

export interface PerformanceCollector {
  startScenario(name: string): void;
  recordFrame(durationMs: number): void;
  recordLongTask(sample: LongTaskSample): void;
  recordVideoEvent(name: VideoEventName): void;
  recordVideoQuality(sample: VideoQualitySample): void;
  recordRouteStart(hash: string): void;
  recordRoutePresented(hash: string): void;
  reset(): void;
  snapshot(): PerformanceSnapshot;
}

export function isPerformanceHarnessRequested(search: string): boolean {
  return new URLSearchParams(search).get("perf") === "1";
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(value * sorted.length) - 1];
}

export function createPerformanceCollector({
  maxSamples = 3_600,
  now = () => performance.now(),
}: { maxSamples?: number; now?: () => number } = {}): PerformanceCollector {
  let name: string | null = null;
  let scenarioStartedAt = 0;
  const frames: number[] = [];
  const longTasks: LongTaskSample[] = [];
  const videoMilestones: Partial<Record<`${VideoEventName}Ms`, number>> = {};
  let firstVideoQuality: VideoQualitySample | null = null;
  let latestVideoQuality: VideoQualitySample | null = null;
  const pendingRoutes = new Map<string, number>();
  const routes: RouteTiming[] = [];

  const reset = () => {
    name = null;
    frames.length = 0;
    longTasks.length = 0;
    for (const key of Object.keys(videoMilestones) as `${VideoEventName}Ms`[]) {
      delete videoMilestones[key];
    }
    firstVideoQuality = null;
    latestVideoQuality = null;
    pendingRoutes.clear();
    routes.length = 0;
  };

  return {
    startScenario(nextName) {
      reset();
      name = nextName;
      scenarioStartedAt = now();
    },
    recordFrame(durationMs) {
      if (name === null || !Number.isFinite(durationMs) || durationMs < 0) return;
      frames.push(durationMs);
      if (frames.length > maxSamples) frames.splice(0, frames.length - maxSamples);
    },
    recordLongTask(sample) {
      if (name === null) return;
      longTasks.push(sample);
      if (longTasks.length > maxSamples) longTasks.splice(0, longTasks.length - maxSamples);
    },
    recordVideoEvent(eventName) {
      const key: `${VideoEventName}Ms` = `${eventName}Ms`;
      if (name === null || videoMilestones[key] !== undefined) return;
      videoMilestones[key] = now() - scenarioStartedAt;
    },
    recordVideoQuality(sample) {
      if (name === null) return;
      firstVideoQuality ??= { ...sample };
      latestVideoQuality = { ...sample };
    },
    recordRouteStart(hash) {
      if (name === null) return;
      pendingRoutes.set(hash, now());
    },
    recordRoutePresented(hash) {
      const startedAt = pendingRoutes.get(hash);
      if (startedAt === undefined) return;
      pendingRoutes.delete(hash);
      routes.push({ hash, durationMs: now() - startedAt });
      if (routes.length > maxSamples) routes.splice(0, routes.length - maxSamples);
    },
    reset,
    snapshot() {
      const sorted = [...frames].sort((a, b) => a - b);
      const totalFrames = Math.max(
        0,
        (latestVideoQuality?.totalVideoFrames ?? 0) - (firstVideoQuality?.totalVideoFrames ?? 0)
      );
      const droppedFrames = Math.max(
        0,
        (latestVideoQuality?.droppedVideoFrames ?? 0) - (firstVideoQuality?.droppedVideoFrames ?? 0)
      );
      return {
        name,
        longTasks: longTasks.map((sample) => ({ ...sample })),
        video: {
          milestones: { ...videoMilestones },
          totalFrames,
          droppedFrames,
          droppedFrameRatio: totalFrames === 0 ? 0 : droppedFrames / totalFrames,
        },
        routes: routes.map((route) => ({ ...route })),
        frames: {
          count: sorted.length,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
          p99Ms: percentile(sorted, 0.99),
          maxMs: sorted.at(-1) ?? 0,
          over16Ms: sorted.filter((duration) => duration > 16.7).length,
          over33Ms: sorted.filter((duration) => duration > 33.3).length,
          over50Ms: sorted.filter((duration) => duration > 50).length,
        },
      };
    },
  };
}
