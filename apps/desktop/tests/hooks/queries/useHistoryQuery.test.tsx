import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import type React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getCachePerformanceSamples,
  resetCachePerformanceSamples,
} from "@/hooks/queries/cache-performance";
import {
  HISTORY_QUERY_KEYS,
  useHistoryActions,
  useHistoryQuery,
} from "@/hooks/queries/useHistoryQuery";
import { useHistoryStore, type HistoryItem } from "@/store/history-store";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "kick-video-v1",
    originalId: "v1",
    title: "Cached VOD",
    thumbnail: "https://example.com/thumb.jpg",
    platform: "kick",
    type: "video",
    channelName: "xqc",
    timestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  resetCachePerformanceSamples();
  useHistoryStore.setState({ history: [] });
});

// Guards: persisted watch history is query-backed so the History page gets the same cache-hit paint telemetry as remote app-data surfaces.
describe("useHistoryQuery", () => {
  it("reads persisted history through TanStack Query and records a cache-hit paint", async () => {
    const history = [makeHistoryItem()];
    useHistoryStore.setState({ history });
    const client = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, refetchOnWindowFocus: false, retry: false },
      },
    });

    const { result } = renderHook(() => useHistoryQuery(), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.data).toEqual(history));
    expect(client.getQueryData(HISTORY_QUERY_KEYS.all)).toEqual(history);
    expect(getCachePerformanceSamples("cache-hit-paint")).toEqual([
      expect.objectContaining({
        surface: "history",
        withinBudget: true,
      }),
    ]);
  });

  it("writes history mutations through the store and updates the query cache", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, refetchOnWindowFocus: false, retry: false },
      },
    });
    const wrapper = makeWrapper(client);
    const query = renderHook(() => useHistoryQuery(), { wrapper });
    const actions = renderHook(() => useHistoryActions(), { wrapper });

    act(() => actions.result.current.addToHistory(makeHistoryItem({ id: "a" })));

    await waitFor(() => expect(query.result.current.data?.map((item) => item.id)).toEqual(["a"]));
    expect(
      client.getQueryData<HistoryItem[]>(HISTORY_QUERY_KEYS.all)?.map((item) => item.id)
    ).toEqual(["a"]);
    expect(useHistoryStore.getState().history.map((item) => item.id)).toEqual(["a"]);

    act(() => actions.result.current.removeFromHistory("a"));

    await waitFor(() => expect(query.result.current.data).toEqual([]));
    expect(useHistoryStore.getState().history).toEqual([]);

    act(() => actions.result.current.addToHistory(makeHistoryItem({ id: "b" })));
    await waitFor(() => expect(query.result.current.data?.map((item) => item.id)).toEqual(["b"]));

    act(() => actions.result.current.clearHistory());

    await waitFor(() => expect(client.getQueryData(HISTORY_QUERY_KEYS.all)).toEqual([]));
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({ surface: "history:add", withinBudget: true }),
      expect.objectContaining({ surface: "history:remove", withinBudget: true }),
      expect.objectContaining({ surface: "history:add", withinBudget: true }),
      expect.objectContaining({ surface: "history:clear", withinBudget: true }),
    ]);
  });
});
