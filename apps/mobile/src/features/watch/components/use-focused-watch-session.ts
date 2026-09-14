import { useSyncExternalStore } from "react";

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
  return useSyncExternalStore(
    session.subscribe,
    () => session.snapshot(target),
    () => session.snapshot(target),
  );
}

export function useWatchPeek(session: FocusedWatchSession): WatchPeek {
  return useSyncExternalStore(
    session.subscribe,
    () => session.peek(),
    () => session.peek(),
  );
}
