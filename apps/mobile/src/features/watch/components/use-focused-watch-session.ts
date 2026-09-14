import { useSyncExternalStore } from "react";

import type {
  FocusedWatchSession,
  FocusedWatchState,
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
