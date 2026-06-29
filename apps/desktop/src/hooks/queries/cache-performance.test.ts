import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_PERFORMANCE_BUDGET_MS,
  getCachePerformanceSamples,
  getCachePerformanceSummary,
  measureCacheInvalidationDispatch,
  recordCachePerformanceSample,
  resetCachePerformanceSamples,
  useQueryCachePerformance,
} from "./cache-performance";

// Guards: cache performance telemetry must distinguish <=50ms budget hits from misses.
// Guards: invalidation telemetry measures synchronous dispatch cost, not platform refetch latency.
describe("cache performance telemetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCachePerformanceSamples();
  });

  it("records whether cache-hit paint is within the 50ms budget", () => {
    recordCachePerformanceSample({
      type: "cache-hit-paint",
      surface: "following",
      startedAt: 100,
      endedAt: 149,
    });
    recordCachePerformanceSample({
      type: "cache-hit-paint",
      surface: "search",
      startedAt: 200,
      endedAt: 251,
    });

    expect(CACHE_PERFORMANCE_BUDGET_MS).toBe(50);
    expect(getCachePerformanceSamples()).toEqual([
      expect.objectContaining({
        type: "cache-hit-paint",
        surface: "following",
        durationMs: 49,
        withinBudget: true,
      }),
      expect.objectContaining({
        type: "cache-hit-paint",
        surface: "search",
        durationMs: 51,
        withinBudget: false,
      }),
    ]);
  });

  it("summarizes p95 and budget misses by event type and surface", () => {
    for (const duration of [10, 20, 30, 40, 60]) {
      recordCachePerformanceSample({
        type: "route-refresh-start",
        surface: "categories",
        startedAt: 0,
        endedAt: duration,
      });
    }

    expect(getCachePerformanceSummary()).toEqual([
      {
        type: "route-refresh-start",
        surface: "categories",
        count: 5,
        p95Ms: 60,
        budgetMisses: 1,
      },
    ]);
  });

  it("measures invalidation dispatch without awaiting background refresh work", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(112);

    const backgroundRefresh = Promise.resolve("done");
    const result = measureCacheInvalidationDispatch("follow-mutation", () => backgroundRefresh);

    expect(result).toBe(backgroundRefresh);
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({
        surface: "follow-mutation",
        durationMs: 12,
        withinBudget: true,
      }),
    ]);
    await backgroundRefresh;
  });

  it("records cached data reaching the mounted surface within the paint budget", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["streams", "followed"];
    queryClient.setQueryData(queryKey, [{ id: "cached-stream" }]);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(
      () =>
        useQueryCachePerformance({
          data: [{ id: "cached-stream" }],
          enabled: true,
          fetchStatus: "idle",
          queryKey,
          surface: "following",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(getCachePerformanceSamples("cache-hit-paint")).toEqual([
        expect.objectContaining({
          surface: "following",
          withinBudget: true,
        }),
      ]);
    });
  });

  it("records route-open refresh start when a mounted surface begins fetching", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["search", "everything", "ice"];
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(
      () =>
        useQueryCachePerformance({
          data: undefined,
          enabled: true,
          fetchStatus: "fetching",
          queryKey,
          surface: "search",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(getCachePerformanceSamples("route-refresh-start")).toEqual([
        expect.objectContaining({
          surface: "search",
          withinBudget: true,
        }),
      ]);
    });
  });

  it("resets route-open timing when the mounted query key changes", async () => {
    const queryClient = new QueryClient();
    const firstQueryKey = ["search", "everything", "ice"];
    const secondQueryKey = ["search", "everything", "maya"];
    queryClient.setQueryData(secondQueryKey, [{ id: "cached-search-result" }]);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { rerender } = renderHook<void, { data: unknown; queryKey: string[] }>(
      ({ data, queryKey }) =>
        useQueryCachePerformance({
          data,
          enabled: true,
          fetchStatus: "idle",
          queryKey,
          surface: "search",
        }),
      {
        initialProps: {
          data: undefined,
          queryKey: firstQueryKey,
        },
        wrapper,
      }
    );

    rerender({
      data: [{ id: "cached-search-result" }],
      queryKey: secondQueryKey,
    });

    await waitFor(() => {
      expect(getCachePerformanceSamples("cache-hit-paint")).toEqual([
        expect.objectContaining({
          surface: "search",
          withinBudget: true,
        }),
      ]);
    });
  });
});
