import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { QueryClient } from "@tanstack/react-query";

import {
  isLiveCardQueryKey,
  LIVE_CARD_REFRESH_MS,
} from "../domain/live-card-refresh";

type LiveStreamCardsState = Readonly<{
  claimThumbnailRefresh: (uri: string) => boolean;
  generation: number;
  needsThumbnailRefresh: (uri: string) => boolean;
  showLargeStreamCards: boolean;
}>;

const LiveStreamCardsContext = createContext<LiveStreamCardsState>({
  claimThumbnailRefresh: () => false,
  generation: 0,
  needsThumbnailRefresh: () => false,
  showLargeStreamCards: false,
});

export function LiveStreamCardsProvider({
  children,
  queryClient,
  showLargeStreamCards,
}: {
  readonly children: ReactNode;
  readonly queryClient: QueryClient;
  readonly showLargeStreamCards: boolean;
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [generation, setGeneration] = useState(0);
  const refreshedUris = useRef(new Set<string>());
  const needsThumbnailRefresh = useCallback(
    (uri: string) => !refreshedUris.current.has(uri),
    [],
  );
  const claimThumbnailRefresh = useCallback((uri: string) => {
    if (refreshedUris.current.has(uri)) return false;
    refreshedUris.current.add(uri);
    return true;
  }, []);
  const refresh = useCallback(() => {
    refreshedUris.current.clear();
    setGeneration((current) => current + 1);
    void queryClient.invalidateQueries({
      predicate: (query) => isLiveCardQueryKey(query.queryKey),
      refetchType: "active",
    });
  }, [queryClient]);

  useEffect(() => {
    let wasActive = AppState.currentState === "active";
    const subscription = AppState.addEventListener("change", (state) => {
      const nextActive = state === "active";
      if (nextActive && !wasActive) refresh();
      wasActive = nextActive;
      setActive(nextActive);
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(refresh, LIVE_CARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const value = useMemo(
    () => ({
      claimThumbnailRefresh,
      generation,
      needsThumbnailRefresh,
      showLargeStreamCards,
    }),
    [
      claimThumbnailRefresh,
      generation,
      needsThumbnailRefresh,
      showLargeStreamCards,
    ],
  );

  return (
    <LiveStreamCardsContext.Provider value={value}>
      {children}
    </LiveStreamCardsContext.Provider>
  );
}

export function useLiveStreamCards(): LiveStreamCardsState {
  return useContext(LiveStreamCardsContext);
}
