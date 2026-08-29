import { useSyncExternalStore } from "react";
import type { VideoPlaybackSnapshot } from "../../../../shared/chat-replay-types";

const INITIAL_PLAYBACK: VideoPlaybackSnapshot = {
  currentTime: 0,
  isPlaying: false,
  playbackRate: 1,
};

export interface ChatReplayPlaybackStore {
  getSnapshot(): VideoPlaybackSnapshot;
  publish(snapshot: VideoPlaybackSnapshot): void;
  requestSeek(offsetSeconds: number): void;
  subscribeToSeek(listener: (offsetSeconds: number) => void): () => void;
  subscribe(listener: () => void): () => void;
}

export function createChatReplayPlaybackStore(): ChatReplayPlaybackStore {
  let snapshot = INITIAL_PLAYBACK;
  const listeners = new Set<() => void>();
  const seekListeners = new Set<(offsetSeconds: number) => void>();

  return {
    getSnapshot: () => snapshot,
    publish: (nextSnapshot) => {
      if (
        snapshot.currentTime === nextSnapshot.currentTime &&
        snapshot.isPlaying === nextSnapshot.isPlaying &&
        snapshot.playbackRate === nextSnapshot.playbackRate
      ) {
        return;
      }
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
    requestSeek: (offsetSeconds) => {
      for (const listener of seekListeners) listener(offsetSeconds);
    },
    subscribeToSeek: (listener) => {
      seekListeners.add(listener);
      return () => seekListeners.delete(listener);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useChatReplayPlaybackSnapshot(
  store: ChatReplayPlaybackStore
): VideoPlaybackSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
