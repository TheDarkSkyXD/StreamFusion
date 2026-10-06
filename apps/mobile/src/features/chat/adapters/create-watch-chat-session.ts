import type {
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatEvent,
  WatchChatEventPreferences,
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
import { readWatchChatHistory } from "./watch-chat-history";
import { applyWatchChatModeration } from "../domain/apply-watch-chat-moderation";

const DEFAULT_EVENT_PREFERENCES: WatchChatEventPreferences = {
  showUserNotices: true,
  showClearMsg: true,
  showClearChat: true,
  firstMsgHighlight: true,
  recentMessagesOnJoin: true,
  recentMessagesLimit: 200,
  deletedMessageDisplay: "compact",
};

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
  readonly messageLimit?: () => number;
  readonly eventPreferences?: () => WatchChatEventPreferences;
}): WatchChatSession {
  const socketFactory =
    input.socketFactory ??
    ((url: string) =>
      new WebSocket(url) as unknown as ReturnType<WatchChatSocketFactory>);
  let snapshot: WatchChatAvailability = CONNECTING;
  let messages: readonly WatchChatMessage[] = [];
  let disposeConnection: (() => void) | null = null;
  let publicationTimer: ReturnType<typeof setTimeout> | undefined;
  let historyAbort: AbortController | null = null;
  let moderationRevision = 0;
  let moderationEvents: Exclude<
    WatchChatEvent,
    { readonly kind: "message" }
  >[] = [];
  let historyDetail: string | undefined;
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
    historyAbort?.abort();
    historyAbort = null;
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
    moderationEvents = [];
    moderationRevision = 0;
    historyDetail = undefined;
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
          moderationRevision,
          ...(historyDetail ? { historyDetail } : {}),
        });
        return;
      }
      setSnapshot(
        historyDetail
          ? { detail: "Chat is live.", kind: "empty", historyDetail }
          : EMPTY_LIVE,
      );
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
      const next = appendWatchChatMessage(
        messages,
        { ...resolved, receivedAt: resolved.receivedAt ?? Date.now() },
        input.messageLimit?.() ?? 100,
      );
      if (next === messages) return;
      messages = next;
      if (publicationTimer !== undefined) return;
      if (snapshot.kind !== "live") {
        setSnapshot({
          detail: "Chat is live.",
          kind: "live",
          messages,
          moderationRevision,
          ...(historyDetail ? { historyDetail } : {}),
        });
      }
      publicationTimer = setTimeout(() => {
        publicationTimer = undefined;
        if (current !== generation) return;
        if (snapshot.kind === "live" && snapshot.messages === messages) return;
        setSnapshot({
          detail: "Chat is live.",
          kind: "live",
          messages,
          moderationRevision,
          ...(historyDetail ? { historyDetail } : {}),
        });
      }, 100);
    };
    const onEvent = (event: WatchChatEvent) => {
      if (current !== generation) return;
      if (event.kind === "message") {
        if (
          event.message.kind !== "notice" ||
          event.message.noticeKind === "system" ||
          (input.eventPreferences?.() ?? DEFAULT_EVENT_PREFERENCES)
            .showUserNotices
        ) {
          onMessage(event.message);
        }
        return;
      }
      if (historyAbort) {
        moderationEvents.push(event);
        if (moderationEvents.length > 100 || event.kind === "clear-room") {
          historyAbort.abort();
          historyAbort = null;
          moderationEvents = [];
        }
      }
      messages = applyWatchChatModeration(messages, event);
      moderationRevision += 1;
      clearTimeout(publicationTimer);
      publicationTimer = undefined;
      const preferences =
        input.eventPreferences?.() ?? DEFAULT_EVENT_PREFERENCES;
      if (event.kind === "clear-room" && preferences.showClearChat) {
        messages = appendWatchChatMessage(
          messages,
          {
            id: `clear-room:${event.at}`,
            kind: "notice",
            noticeKind: "system",
            displayName: "System",
            text: "Chat was cleared",
            badges: [],
            receivedAt: event.at,
          },
          input.messageLimit?.() ?? 100,
        );
      }
      if (event.kind === "clear-user" && preferences.showClearChat) {
        const name = event.username ?? "A user";
        const action =
          event.durationSeconds === undefined ? "banned" : "timed out";
        messages = appendWatchChatMessage(
          messages,
          {
            id: `clear-user:${event.at}:${event.userId ?? name}`,
            kind: "notice",
            noticeKind: "system",
            displayName: "System",
            text: `${name} was ${action}`,
            badges: [],
            receivedAt: event.at,
          },
          input.messageLimit?.() ?? 100,
        );
      }
      setSnapshot(
        messages.length > 0
          ? {
              detail: "Chat is live.",
              kind: "live",
              messages,
              moderationRevision,
              ...(historyDetail ? { historyDetail } : {}),
            }
          : {
              detail: "Chat is live.",
              kind: "empty",
              moderationRevision,
              ...(historyDetail ? { historyDetail } : {}),
            },
      );
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
        onEvent,
        onOpen,
        socketFactory,
        target,
      });
    } else {
      const abort = new AbortController();
      void connectKickGuestChat({
        fetch: input.fetch,
        onClose: () => onError("Kick chat disconnected. Retry to reconnect."),
        onError,
        onMessage,
        onEvent,
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
    }
    const preferences = input.eventPreferences?.() ?? DEFAULT_EVENT_PREFERENCES;
    if (preferences.recentMessagesOnJoin) {
      const abort = new AbortController();
      historyAbort = abort;
      void readWatchChatHistory({
        fetch: input.fetch,
        target,
        limit: preferences.recentMessagesLimit,
        signal: abort.signal,
      }).then((history) => {
        if (current !== generation || abort.signal.aborted) return;
        historyAbort = null;
        if (history.kind === "unavailable") {
          historyDetail = history.detail;
          if (snapshot.kind === "live" || snapshot.kind === "empty") {
            setSnapshot({ ...snapshot, historyDetail });
          }
          return;
        }
        if (history.messages.length === 0) return;
        let seed: readonly WatchChatMessage[] = history.messages;
        for (const event of moderationEvents)
          seed = applyWatchChatModeration(seed, event);
        moderationEvents = [];
        if (
          !(input.eventPreferences?.() ?? DEFAULT_EVENT_PREFERENCES)
            .showUserNotices
        ) {
          seed = seed.filter(
            (message) =>
              message.kind !== "notice" || message.noticeKind === "system",
          );
        }
        const liveIds = new Set(messages.map((message) => message.id));
        messages = [
          ...seed.filter((message) => !liveIds.has(message.id)),
          ...messages,
        ].slice(-(input.messageLimit?.() ?? 100));
        if (snapshot.kind !== "live" && snapshot.kind !== "empty") return;
        setSnapshot({
          detail: "Chat is live.",
          kind: "live",
          messages,
          moderationRevision,
          ...(historyDetail ? { historyDetail } : {}),
        });
      });
    }
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
