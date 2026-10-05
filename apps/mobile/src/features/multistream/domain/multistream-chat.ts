import type {
  WatchChatAvailability,
  WatchChatMessage,
  WatchChatSession,
} from "@mobile/features/chat/capabilities/watch-chat";
import type {
  MultistreamChat,
  MultistreamChatFactory,
} from "../capabilities/multistream-chat";
import type { MultistreamTile } from "../capabilities/multistream";

export function createMultistreamChat(
  create: MultistreamChatFactory,
): MultistreamChat {
  const feeds = new Map<
    string,
    {
      readonly session: WatchChatSession;
      readonly unsubscribe: () => void;
      readonly tile: MultistreamTile;
    }
  >();
  const listeners = new Set<() => void>();
  let messages: readonly WatchChatMessage[] = [];
  const seen = new Set<string>();
  let merged: WatchChatAvailability = {
    kind: "empty",
    detail: "Add a stream to connect chat.",
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const collect = () => {
    const details: string[] = [];
    for (const [id, feed] of feeds) {
      const view = feed.session.snapshot();
      if (view.kind === "failed" || view.kind === "unavailable")
        details.push(`${feed.tile.target.channelName}: ${view.detail}`);
      if (view.kind !== "live") continue;
      for (const message of view.messages) {
        const key = `${id}:${message.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        messages = [
          ...messages,
          {
            ...message,
            id: key,
            displayName: `[${feed.tile.target.channelName}] ${message.displayName}`,
          },
        ].slice(-200);
      }
    }
    if (seen.size > 1000) {
      seen.clear();
      for (const [id, feed] of feeds) {
        const view = feed.session.snapshot();
        if (view.kind === "live")
          for (const message of view.messages) seen.add(`${id}:${message.id}`);
      }
    }
    const detail = details.length
      ? details.join(" · ")
      : "Choose a channel below to send messages.";
    merged = messages.length
      ? { kind: "live", messages, detail }
      : { kind: "empty", detail };
    emit();
  };
  return {
    attach(tiles) {
      const active = new Set(tiles.map((tile) => tile.id));
      for (const [id, feed] of feeds) {
        if (active.has(id)) continue;
        feed.unsubscribe();
        feed.session.dispose();
        feeds.delete(id);
        messages = messages.filter(
          (message) => !message.id.startsWith(`${id}:`),
        );
      }
      for (const tile of tiles) {
        if (feeds.has(tile.id)) continue;
        const session = create();
        const unsubscribe = session.subscribe(collect);
        feeds.set(tile.id, { session, unsubscribe, tile });
        session.attach(tile.target);
      }
      if (tiles.length === 0) {
        seen.clear();
        messages = [];
      }
      collect();
    },
    snapshot(channelId) {
      return channelId === null
        ? merged
        : (feeds.get(channelId)?.session.snapshot() ?? {
            kind: "empty",
            detail: "Choose an active channel.",
          });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry(channelId) {
      for (const [id, feed] of feeds)
        if (channelId === null || channelId === id) feed.session.retry();
    },
    dispose() {
      for (const feed of feeds.values()) {
        feed.unsubscribe();
        feed.session.dispose();
      }
      feeds.clear();
      seen.clear();
      messages = [];
      merged = { kind: "empty", detail: "Add a stream to connect chat." };
      emit();
    },
  };
}
