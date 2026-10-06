import type {
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSession,
  WatchChatSocketFactory,
  ChatReplayReader,
} from "../capabilities/watch-chat";
import { appendWatchChatMessage } from "../domain/watch-chat-messages";
import {
  ensureTwitchGlobalBadgeCatalog,
  resolveTwitchBadges,
} from "../domain/twitch-global-badge-catalog";
import { connectKickGuestChat } from "./kick-guest-pusher";
import { connectTwitchGuestIrc } from "./twitch-guest-irc";
import { createRecordedChatSession } from "../domain/recorded-chat-session";
import { RECORDED_COMMENTS } from "../capabilities/watch-chat";

const CONNECTING: WatchChatAvailability = {
  detail: "Connecting guest chat.",
  kind: "connecting",
};

const EMPTY_LIVE: WatchChatAvailability = {
  detail: "Chat is live.",
  kind: "empty",
};

export function createWatchChatSession(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly socketFactory?: WatchChatSocketFactory;
  readonly replayReader?: ChatReplayReader;
}): WatchChatSession {
  const socketFactory =
    input.socketFactory ??
    ((url: string) =>
      new WebSocket(url) as unknown as ReturnType<WatchChatSocketFactory>);
  let snapshot: WatchChatAvailability = CONNECTING;
  let messages: readonly WatchChatMessage[] = [];
  let disposeConnection: (() => void) | null = null;
  let publicationTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let attached: WatchChatConnectInput | null = null;
  const listeners = new Set<() => void>();
  const replay = input.replayReader
    ? createRecordedChatSession(input.replayReader)
    : null;
  let recorded = false;
  const emit = () => {
    for (const listener of listeners) listener();
  };
  replay?.subscribe(emit);
  const setSnapshot = (next: WatchChatAvailability) => {
    snapshot = next;
    emit();
  };
  const disconnect = () => {
    clearTimeout(publicationTimer);
    publicationTimer = undefined;
    disposeConnection?.();
    disposeConnection = null;
  };

  const connect = (target: WatchChatConnectInput) => {
    const current = ++generation;
    disconnect();
    replay?.dispose();
    attached = target;
    messages = [];
    recorded = target.media !== undefined;
    if (recorded) {
      if (replay) replay.attach(target);
      else setSnapshot(RECORDED_COMMENTS);
      return;
    }
    setSnapshot(CONNECTING);
    const onOpen = () => {
      if (current !== generation) return;
      if (messages.length > 0) {
        setSnapshot({
          detail: "Chat is live.",
          kind: "live",
          messages,
        });
        return;
      }
      setSnapshot(EMPTY_LIVE);
    };
    const onMessage = (message: WatchChatMessage) => {
      if (current !== generation) return;
      const resolved =
        target.platform !== "twitch" || message.badges.length === 0
          ? message
          : {
              ...message,
              badges: resolveTwitchBadges(
                message.badges.map((badge) => ({
                  setId: badge.setId,
                  version: badge.version,
                })),
              ),
            };
      messages = appendWatchChatMessage(messages, resolved);
      if (publicationTimer !== undefined) return;
      if (snapshot.kind !== "live") {
        setSnapshot({ detail: "Chat is live.", kind: "live", messages });
      }
      publicationTimer = setTimeout(() => {
        publicationTimer = undefined;
        if (current !== generation) return;
        setSnapshot({ detail: "Chat is live.", kind: "live", messages });
      }, 250);
    };
    const onError = (detail: string) => {
      if (current !== generation) return;
      clearTimeout(publicationTimer);
      publicationTimer = undefined;
      setSnapshot({ detail, kind: "failed", retry: "manual" });
    };
    if (target.platform === "twitch") {
      void ensureTwitchGlobalBadgeCatalog(input.fetch).catch(() => undefined);
      disposeConnection = connectTwitchGuestIrc({
        onClose: () => onError("Twitch chat disconnected. Retry to reconnect."),
        onError,
        onMessage,
        onOpen,
        socketFactory,
        target,
      });
      return;
    }
    const abort = new AbortController();
    void connectKickGuestChat({
      fetch: input.fetch,
      onClose: () => onError("Kick chat disconnected. Retry to reconnect."),
      onError,
      onMessage,
      onOpen,
      signal: abort.signal,
      socketFactory,
      target,
    })
      .then((close) => {
        if (current !== generation) {
          close();
          return;
        }
        disposeConnection = () => {
          abort.abort();
          close();
        };
      })
      .catch(() => onError("Kick chat could not connect."));
    disposeConnection = () => abort.abort();
  };

  return {
    attach(target) {
      connect(target);
    },
    dispose() {
      generation += 1;
      attached = null;
      disconnect();
      replay?.dispose();
      recorded = false;
      messages = [];
      snapshot = CONNECTING;
    },
    retry() {
      if (recorded && replay) replay.retry();
      else if (attached) connect(attached);
    },
    snapshot: () => (recorded && replay ? replay.snapshot() : snapshot),
    syncPlayback(positionMs) {
      if (recorded) replay?.syncPlayback?.(positionMs);
    },
    seekPlayback(positionMs) {
      if (recorded) replay?.seekPlayback?.(positionMs);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
