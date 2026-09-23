import type {
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
  WatchChatSession,
  WatchChatSocketFactory,
} from "../capabilities/watch-chat";
import { appendWatchChatMessage } from "../domain/watch-chat-messages";
import { connectKickGuestChat } from "./kick-guest-pusher";
import { connectTwitchGuestIrc } from "./twitch-guest-irc";

const CONNECTING: WatchChatAvailability = {
  detail: "Connecting guest chat.",
  kind: "connecting",
};

const EMPTY_LIVE: WatchChatAvailability = {
  detail: "Guest chat is live. Sending stays locked.",
  kind: "empty",
};

export function createWatchChatSession(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly socketFactory?: WatchChatSocketFactory;
}): WatchChatSession {
  const socketFactory =
    input.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as ReturnType<WatchChatSocketFactory>);
  let snapshot: WatchChatAvailability = CONNECTING;
  let messages: readonly WatchChatMessage[] = [];
  let disposeConnection: (() => void) | null = null;
  let generation = 0;
  let attached: WatchChatConnectInput | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const setSnapshot = (next: WatchChatAvailability) => {
    snapshot = next;
    emit();
  };
  const disconnect = () => {
    disposeConnection?.();
    disposeConnection = null;
  };

  const connect = (target: WatchChatConnectInput) => {
    disconnect();
    attached = target;
    messages = [];
    const current = ++generation;
    setSnapshot(CONNECTING);
    const onOpen = () => {
      if (current !== generation) return;
      if (messages.length > 0) {
        setSnapshot({
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages,
        });
        return;
      }
      setSnapshot(EMPTY_LIVE);
    };
    const onMessage = (message: WatchChatMessage) => {
      if (current !== generation) return;
      messages = appendWatchChatMessage(messages, message);
      setSnapshot({
        detail: "Guest chat is live. Sending stays locked.",
        kind: "live",
        messages,
      });
    };
    const onError = (detail: string) => {
      if (current !== generation) return;
      setSnapshot({ detail, kind: "failed", retry: "manual" });
    };
    if (target.platform === "twitch") {
      disposeConnection = connectTwitchGuestIrc({
        onClose: () => undefined,
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
      onClose: () => undefined,
      onError,
      onMessage,
      onOpen,
      signal: abort.signal,
      socketFactory,
      target,
    }).then((close) => {
      if (current !== generation) {
        close();
        return;
      }
      disposeConnection = () => {
        abort.abort();
        close();
      };
    });
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
      messages = [];
      snapshot = CONNECTING;
    },
    retry() {
      if (attached) connect(attached);
    },
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
