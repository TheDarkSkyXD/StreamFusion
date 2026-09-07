import type {
  CollectionGap,
  DiagnosticsHistoryBucket,
  DiagnosticsHistorySeries,
} from "@shared/diagnostics-types";

export type DiagnosticsHistoryTimelineSlot =
  | { readonly kind: "observed"; readonly bucket: DiagnosticsHistoryBucket }
  | {
      readonly kind: "gap";
      readonly startedAtMs: number;
      readonly endedAtMs: number;
      readonly cause: CollectionGap["cause"] | null;
    };

export const HISTORY_CHART_WIDTH = 1_000;
export const HISTORY_CHART_BASELINE = 96;

export function historyPointY(value: number, maximum: number): number {
  return HISTORY_CHART_BASELINE - (value / Math.max(1, maximum)) * 92;
}

export function historyWavePaths({
  slots,
  value,
  maximum,
}: {
  readonly slots: readonly DiagnosticsHistoryTimelineSlot[];
  readonly value: (bucket: DiagnosticsHistoryBucket) => number;
  readonly maximum: number;
}): readonly { readonly line: string; readonly area: string }[] {
  const paths: { line: string; area: string }[] = [];
  let run: { firstX: number; lastX: number; lastY: number; line: string } | null = null;
  const finishRun = (): void => {
    if (!run) return;
    paths.push({
      line: run.line,
      area: `${run.line} L ${run.lastX} ${HISTORY_CHART_BASELINE} L ${run.firstX} ${HISTORY_CHART_BASELINE} Z`,
    });
    run = null;
  };
  slots.forEach((slot, index) => {
    if (slot.kind === "gap") {
      finishRun();
      return;
    }
    const x = ((index + 0.5) / slots.length) * HISTORY_CHART_WIDTH;
    const y = historyPointY(value(slot.bucket), maximum);
    if (!run) {
      run = { firstX: x, lastX: x, lastY: y, line: `M ${x} ${y}` };
      return;
    }
    const midpointX = (run.lastX + x) / 2;
    run.line += ` C ${midpointX} ${run.lastY} ${midpointX} ${y} ${x} ${y}`;
    run.lastX = x;
    run.lastY = y;
  });
  finishRun();
  return paths;
}

function historyBucketDurationMs(series: DiagnosticsHistorySeries): number {
  if (series.resolution === "1s") return 1_000;
  if (series.resolution === "minute") return 60_000;
  if (series.resolution === "hour") return 60 * 60_000;
  if (series.resolution === "5m") return 5 * 60_000;
  if (series.resolution === "30m") return 30 * 60_000;
  if (series.resolution === "2h") return 2 * 60 * 60_000;
  if (series.resolution === "8h") return 8 * 60 * 60_000;
  return 10_000;
}

/** Produces the requested time axis, retaining missing periods as explicit gaps. */
export function historyTimelineSlots(
  series: DiagnosticsHistorySeries
): readonly DiagnosticsHistoryTimelineSlot[] {
  const bucketMs = historyBucketDurationMs(series);
  const byStartAtMs = new Map(series.buckets.map((bucket) => [bucket.startedAtMs, bucket]));
  const slots: DiagnosticsHistoryTimelineSlot[] = [];
  const firstStartedAtMs = Math.floor(series.requested.startAtMs / bucketMs) * bucketMs;
  for (
    let startedAtMs = firstStartedAtMs;
    startedAtMs < series.requested.endAtMs;
    startedAtMs += bucketMs
  ) {
    const bucket = byStartAtMs.get(startedAtMs);
    if (bucket) {
      slots.push({ kind: "observed", bucket });
      continue;
    }
    const endedAtMs = Math.min(series.requested.endAtMs, startedAtMs + bucketMs);
    const gap = series.gaps.find(
      (candidate) => candidate.startedAtMs < endedAtMs && candidate.endedAtMs > startedAtMs
    );
    slots.push({ kind: "gap", startedAtMs, endedAtMs, cause: gap?.cause ?? null });
  }
  return slots;
}
