import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type {
  WatchHistoryItem,
  WatchHistoryOpenMode,
  WatchHistoryRepository,
} from "../capabilities/watch-history";
import {
  composeWatchHistoryView,
  type WatchHistoryConfirmation,
  type WatchHistoryView,
} from "../domain/watch-history-view";
import { watchTargetFromHistory } from "../domain/watch-history";

export function useWatchHistory(input: {
  readonly readNetwork: () => Promise<"online" | "offline">;
  readonly repository: WatchHistoryRepository;
}): {
  readonly model: WatchHistoryView;
  readonly cancel: () => void;
  readonly confirm: () => Promise<void>;
  readonly open: (item: WatchHistoryItem, mode: WatchHistoryOpenMode) => WatchTarget;
  readonly refresh: () => Promise<void>;
  readonly refreshing: boolean;
  readonly requestClear: () => void;
  readonly requestRemove: (item: WatchHistoryItem) => void;
  readonly setQuery: (query: string) => void;
} {
  const [query, setQuery] = useState("");
  const [writeFailed, setWriteFailed] = useState(false);
  const [confirmation, setConfirmation] =
    useState<WatchHistoryConfirmation | null>(null);
  const historyQuery = useQuery({
    queryFn: () => input.repository.list(),
    queryKey: ["watch-history"],
  });
  const networkQuery = useQuery({
    queryFn: input.readNetwork,
    queryKey: ["watch-history-network"],
  });

  return {
    model: composeWatchHistoryView({
      confirmation,
      items: historyQuery.data ?? [],
      offline: networkQuery.data === "offline",
      query,
      unavailable: historyQuery.isError || writeFailed,
    }),
    cancel: () => setConfirmation(null),
    confirm: async () => {
      if (!confirmation) return;
      try {
        if (confirmation.kind === "clear") await input.repository.clear();
        else await input.repository.remove(confirmation.id);
        setConfirmation(null);
        setWriteFailed(false);
        await historyQuery.refetch();
      } catch {
        setWriteFailed(true);
      }
    },
    open: (item, mode) => watchTargetFromHistory(item, mode),
    refresh: async () => {
      setWriteFailed(false);
      await historyQuery.refetch();
      await networkQuery.refetch();
    },
    refreshing: historyQuery.isFetching || networkQuery.isFetching,
    requestClear: () => setConfirmation({ kind: "clear" }),
    requestRemove: (item) =>
      setConfirmation({ id: item.id, kind: "remove", title: item.title }),
    setQuery,
  };
}
