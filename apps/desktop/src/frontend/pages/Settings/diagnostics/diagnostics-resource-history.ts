import type { DiagnosticsWindowMinutes, ResourcePoint } from "@shared/diagnostics-types";

const DEFAULT_SAMPLE_DURATION_MS = 1_000;
const MAX_OBSERVED_SAMPLE_DURATION_MS = 5_000;

export interface DiagnosticsResourceBucket {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly avgCpuPercent: number;
  readonly maxCpuPercent: number;
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
}

export interface DiagnosticsResourceWindow {
  readonly windowMs: number;
  readonly bucketMs: number;
}

const RESOURCE_WINDOWS: Readonly<Record<DiagnosticsWindowMinutes, DiagnosticsResourceWindow>> = {
  5: { windowMs: 5 * 60_000, bucketMs: 15_000 },
  15: { windowMs: 15 * 60_000, bucketMs: 30_000 },
  30: { windowMs: 30 * 60_000, bucketMs: 60_000 },
  60: { windowMs: 60 * 60_000, bucketMs: 2 * 60_000 },
};

export function resourceWindow(windowMinutes: DiagnosticsWindowMinutes): DiagnosticsResourceWindow {
  return RESOURCE_WINDOWS[windowMinutes];
}

export function bucketDiagnosticsResourceHistory(
  history: readonly ResourcePoint[],
  windowMinutes: DiagnosticsWindowMinutes,
  nowMs: number
): readonly DiagnosticsResourceBucket[] {
  const { bucketMs, windowMs } = resourceWindow(windowMinutes);
  const cutoffMs = nowMs - windowMs;
  const accumulators = new Map<
    number,
    {
      cpuTotal: number;
      cpuMaximum: number;
      samples: number;
      ioReadBytes: number;
      ioWriteBytes: number;
    }
  >();

  for (let index = 0; index < history.length; index += 1) {
    const point = history[index];
    if (point.observedAtMs < cutoffMs || point.observedAtMs > nowMs) continue;

    const startedAtMs = Math.floor(point.observedAtMs / bucketMs) * bucketMs;
    const accumulator = accumulators.get(startedAtMs) ?? {
      cpuTotal: 0,
      cpuMaximum: 0,
      samples: 0,
      ioReadBytes: 0,
      ioWriteBytes: 0,
    };
    const previous = history[index - 1];
    const elapsedMs = previous
      ? Math.min(
          MAX_OBSERVED_SAMPLE_DURATION_MS,
          Math.max(1, point.observedAtMs - previous.observedAtMs)
        )
      : DEFAULT_SAMPLE_DURATION_MS;
    const elapsedSeconds = elapsedMs / 1_000;

    accumulator.cpuTotal += point.cpuPercent;
    accumulator.cpuMaximum = Math.max(accumulator.cpuMaximum, point.cpuPercent);
    accumulator.samples += 1;
    accumulator.ioReadBytes += (point.readBytesPerSecond ?? 0) * elapsedSeconds;
    accumulator.ioWriteBytes += (point.writeBytesPerSecond ?? 0) * elapsedSeconds;
    accumulators.set(startedAtMs, accumulator);
  }

  return [...accumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([startedAtMs, accumulator]) => ({
      startedAtMs,
      endedAtMs: startedAtMs + bucketMs,
      avgCpuPercent: accumulator.cpuTotal / accumulator.samples,
      maxCpuPercent: accumulator.cpuMaximum,
      ioReadBytes: accumulator.ioReadBytes,
      ioWriteBytes: accumulator.ioWriteBytes,
    }));
}

export function resourceHistoryBarHeight(input: {
  readonly value: number;
  readonly max: number;
  readonly minimumVisiblePercent: number;
}): number {
  if (input.value <= 0) return 0;
  return Math.max(input.minimumVisiblePercent, (input.value / Math.max(1, input.max)) * 100);
}
