import { useEffect, useSyncExternalStore } from "react";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import type {
  WatchChatAvailability,
  WatchChatSession,
} from "../capabilities/watch-chat";
import { RECORDED_COMMENTS } from "../capabilities/watch-chat";

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
  const live = useSyncExternalStore(
    session?.subscribe ?? subscribeNoop,
    session?.snapshot ?? emptySnapshot,
  );
  if (recorded) return RECORDED_COMMENTS;
  if (session === null) {
    return {
      detail: "Guest chat is not attached to this player.",
      kind: "unavailable",
      reason: "platform",
    };
  }
  return live;
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function emptySnapshot(): WatchChatAvailability {
  return { detail: "Connecting guest chat.", kind: "connecting" };
}
