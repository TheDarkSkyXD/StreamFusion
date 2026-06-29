import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const CACHE_PERFORMANCE_BUDGET_MS = 50;

export type CachePerformanceEventType =
  | "cache-hit-paint"
  | "route-refresh-start"
  | "cache-invalidation";

export interface CachePerformanceSampleInput {
  type: CachePerformanceEventType;
  surface: string;
  startedAt: number;
  endedAt: number;
}

export interface CachePerformanceSample extends CachePerformanceSampleInput {
  durationMs: number;
  withinBudget: boolean;
}

export interface CachePerformanceSummary {
  type: CachePerformanceEventType;
  surface: string;
  count: number;
  p95Ms: number;
  budgetMisses: number;
}

interface QueryCachePerformanceOptions {
  data: unknown;
  enabled?: boolean;
  fetchStatus?: "fetching" | "paused" | "idle";
  queryKey: QueryKey;
  surface: string;
}

const MAX_SAMPLES = 500;
const samples: CachePerformanceSample[] = [];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getTraceKey(surface: string, enabled: boolean, queryKey: QueryKey): string {
  return JSON.stringify([surface, enabled, queryKey]);
}

function getGlobalDebugTarget() {
  if (typeof window === "undefined") return null;
  return window as Window & {
    __streamfusionCachePerformance?: {
      budgetMs: number;
      getSamples: typeof getCachePerformanceSamples;
      getSummary: typeof getCachePerformanceSummary;
      reset: typeof resetCachePerformanceSamples;
    };
  };
}

function exposeDebugTarget(): void {
  const target = getGlobalDebugTarget();
  if (!target || target.__streamfusionCachePerformance) return;

  target.__streamfusionCachePerformance = {
    budgetMs: CACHE_PERFORMANCE_BUDGET_MS,
    getSamples: getCachePerformanceSamples,
    getSummary: getCachePerformanceSummary,
    reset: resetCachePerformanceSamples,
  };
}

export function recordCachePerformanceSample(
  input: CachePerformanceSampleInput
): CachePerformanceSample {
  const durationMs = Math.max(0, input.endedAt - input.startedAt);
  const sample: CachePerformanceSample = {
    ...input,
    durationMs,
    withinBudget: durationMs <= CACHE_PERFORMANCE_BUDGET_MS,
  };

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }

  exposeDebugTarget();
  return sample;
}

export function measureCacheInvalidationDispatch<T>(surface: string, dispatch: () => T): T {
  const startedAt = now();
  try {
    return dispatch();
  } finally {
    recordCachePerformanceSample({
      type: "cache-invalidation",
      surface,
      startedAt,
      endedAt: now(),
    });
  }
}

export function useQueryCachePerformance({
  data,
  enabled = true,
  fetchStatus,
  queryKey,
  surface,
}: QueryCachePerformanceOptions): void {
  const queryClient = useQueryClient();
  const traceKey = getTraceKey(surface, enabled, queryKey);
  const traceKeyRef = useRef<string | null>(null);
  const openedAtRef = useRef<number | null>(null);
  const hadCachedDataAtOpenRef = useRef(false);
  const recordedCacheHitPaintRef = useRef(false);
  const recordedRefreshStartRef = useRef(false);

  if (traceKeyRef.current !== traceKey) {
    traceKeyRef.current = traceKey;
    openedAtRef.current = now();
    hadCachedDataAtOpenRef.current = queryClient.getQueryData(queryKey) !== undefined;
    recordedCacheHitPaintRef.current = false;
    recordedRefreshStartRef.current = false;
  }

  useEffect(() => {
    if (
      !enabled ||
      traceKeyRef.current !== traceKey ||
      recordedRefreshStartRef.current ||
      fetchStatus !== "fetching"
    ) {
      return;
    }

    recordedRefreshStartRef.current = true;
    recordCachePerformanceSample({
      type: "route-refresh-start",
      surface,
      startedAt: openedAtRef.current ?? now(),
      endedAt: now(),
    });
  }, [enabled, fetchStatus, surface, traceKey]);

  useEffect(() => {
    if (
      !enabled ||
      traceKeyRef.current !== traceKey ||
      !hadCachedDataAtOpenRef.current ||
      recordedCacheHitPaintRef.current ||
      data === undefined
    ) {
      return;
    }

    recordedCacheHitPaintRef.current = true;
    recordCachePerformanceSample({
      type: "cache-hit-paint",
      surface,
      startedAt: openedAtRef.current ?? now(),
      endedAt: now(),
    });
  }, [data, enabled, surface, traceKey]);
}

export function getCachePerformanceSamples(
  type?: CachePerformanceEventType
): CachePerformanceSample[] {
  return type ? samples.filter((sample) => sample.type === type) : [...samples];
}

export function getCachePerformanceSummary(): CachePerformanceSummary[] {
  const groups = new Map<string, CachePerformanceSample[]>();

  for (const sample of samples) {
    const key = `${sample.type}:${sample.surface}`;
    const group = groups.get(key);
    if (group) {
      group.push(sample);
    } else {
      groups.set(key, [sample]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const sortedDurations = group.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1);
    const first = group[0];

    return {
      type: first.type,
      surface: first.surface,
      count: group.length,
      p95Ms: sortedDurations[p95Index],
      budgetMisses: group.filter((sample) => !sample.withinBudget).length,
    };
  });
}

export function resetCachePerformanceSamples(): void {
  samples.length = 0;
}

exposeDebugTarget();
