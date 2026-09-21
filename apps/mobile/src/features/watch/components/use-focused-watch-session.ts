import { useCallback, useSyncExternalStore } from "react";

import type {
  FocusedWatchSession,
  FocusedWatchState,
  WatchPeek,
  WatchTarget,
} from "../capabilities/watch";

export function useFocusedWatchSession(
  session: FocusedWatchSession,
  target: WatchTarget,
): FocusedWatchState {
  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const getSnapshot = useCallback(
    () => session.snapshot(target),
    [session, target],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useWatchPeek(session: FocusedWatchSession): WatchPeek {
  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const getSnapshot = useCallback(() => session.peek(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
