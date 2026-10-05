import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import type {
  WatchChatAvailability,
  WatchChatSession,
} from "../capabilities/watch-chat";

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
  const mediaId = target.media?.id;
  const mediaKind = target.media?.kind;
  const resumePositionSeconds = target.media?.resumePositionSeconds;
  useEffect(() => {
    if (session === null) return undefined;
    session.attach({
      channelId: target.channelId,
      channelName: target.channelName,
      platform: target.platform,
      ...(mediaId === undefined || mediaKind === undefined
        ? {}
        : {
            media: {
              id: mediaId,
              kind: mediaKind,
              ...(resumePositionSeconds === undefined
                ? {}
                : { resumePositionSeconds }),
            },
          }),
    });
    return () => session.dispose();
  }, [
    recorded,
    session,
    target.channelId,
    target.channelName,
    target.platform,
    mediaId,
    mediaKind,
    resumePositionSeconds,
  ]);
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
  if (session === null) return UNAVAILABLE_WATCH_CHAT_SNAPSHOT;
  return live;
}

function subscribeNoop(): () => void {
  return () => undefined;
}
