import type {
  CollectionGap,
  DiagnosticsHistoryBucket,
  DiagnosticsHistorySeries,
} from "@shared/diagnostics-types";

export function resourceHistoryBarHeight(input: {
  readonly value: number;
  readonly max: number;
  readonly minimumVisiblePercent: number;
}): number {
  if (input.value <= 0) return 0;
  return Math.max(input.minimumVisiblePercent, (input.value / Math.max(1, input.max)) * 100);
}

export type DiagnosticsHistoryTimelineSlot =
  | { readonly kind: "observed"; readonly bucket: DiagnosticsHistoryBucket }
  | {
      readonly kind: "gap";
      readonly startedAtMs: number;
      readonly endedAtMs: number;
      readonly cause: CollectionGap["cause"] | null;
    };

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
