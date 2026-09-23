import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import type {
  WatchChatAvailability,
  WatchChatSession,
} from "../capabilities/watch-chat";
import { RECORDED_COMMENTS } from "../capabilities/watch-chat";

/** Cached for useSyncExternalStore — a fresh object each call can loop subscribers. */
export const CONNECTING_WATCH_CHAT_SNAPSHOT: WatchChatAvailability = {
  detail: "Connecting guest chat.",
  kind: "connecting",
};

const UNAVAILABLE_WATCH_CHAT_SNAPSHOT: WatchChatAvailability = {
  detail: "Guest chat is not attached to this player.",
  kind: "unavailable",
  reason: "platform",
};

export function useWatchChat(
  session: WatchChatSession | null,
  target: WatchTarget,
): WatchChatAvailability {
  const recorded = target.media !== undefined;
  useEffect(() => {
    if (session === null || recorded) return undefined;
    session.attach({
      channelId: target.channelId,
      channelName: target.channelName,
      platform: target.platform,
    });
    return () => session.dispose();
  }, [recorded, session, target.channelId, target.channelName, target.platform]);
  const subscribe = useCallback(
    (listener: () => void) =>
      session === null ? subscribeNoop() : session.subscribe(listener),
    [session],
  );
  const getSnapshot = useCallback(
    () =>
      session === null ? CONNECTING_WATCH_CHAT_SNAPSHOT : session.snapshot(),
    [session],
  );
  const live = useSyncExternalStore(subscribe, getSnapshot);
  if (recorded) return RECORDED_COMMENTS;
  if (session === null) return UNAVAILABLE_WATCH_CHAT_SNAPSHOT;
  return live;
}

function subscribeNoop(): () => void {
  return () => undefined;
}
