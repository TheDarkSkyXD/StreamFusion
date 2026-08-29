import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { type HistoryItem, useHistoryStore } from "@/store/history-store";

import { measureCacheInvalidationDispatch, useQueryCachePerformance } from "../../discovery/data/queries/cache-performance";
import { getQueryCacheOptions } from "../../discovery/data/queries/cache-policy";

export const HISTORY_QUERY_KEYS = {
  all: ["history"] as const,
};

type HistoryInput = Omit<HistoryItem, "timestamp">;

function readHistory(): HistoryItem[] {
  return useHistoryStore.getState().history;
}

export function useHistoryQuery() {
  const queryKey = HISTORY_QUERY_KEYS.all;
  const query = useQuery({
    queryKey,
    queryFn: async () => readHistory(),
    initialData: readHistory,
    ...getQueryCacheOptions("localUserState"),
  });

  useQueryCachePerformance({
    data: query.data,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "history",
  });

  return query;
}

export function useHistoryActions() {
  const queryClient = useQueryClient();

  const syncHistoryCache = useCallback(() => {
    queryClient.setQueryData(HISTORY_QUERY_KEYS.all, readHistory());
  }, [queryClient]);

  const addToHistory = useCallback(
    (item: HistoryInput) =>
      measureCacheInvalidationDispatch("history:add", () => {
        useHistoryStore.getState().addToHistory(item);
        syncHistoryCache();
      }),
    [syncHistoryCache]
  );

  const clearHistory = useCallback(
    () =>
      measureCacheInvalidationDispatch("history:clear", () => {
        useHistoryStore.getState().clearHistory();
        syncHistoryCache();
      }),
    [syncHistoryCache]
  );

  const removeFromHistory = useCallback(
    (id: string) =>
      measureCacheInvalidationDispatch("history:remove", () => {
        useHistoryStore.getState().removeFromHistory(id);
        syncHistoryCache();
      }),
    [syncHistoryCache]
  );

  return useMemo(
    () => ({
      addToHistory,
      clearHistory,
      removeFromHistory,
    }),
    [addToHistory, clearHistory, removeFromHistory]
  );
}
