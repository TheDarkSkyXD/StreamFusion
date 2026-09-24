import type { VideoPlayer } from "expo-video";

import type { NativePlaybackEvent } from "../../capabilities/watch";

export type ExpoHlsPlaybackEntry = {
  readonly player: VideoPlayer;
  readonly sessionId: string;
};

type Listener = (event: NativePlaybackEvent) => void;

const entries = new Map<string, ExpoHlsPlaybackEntry>();
const listeners = new Set<Listener>();
const registryListeners = new Set<() => void>();

export function getExpoHlsPlaybackEntry(
  sessionId: string,
): ExpoHlsPlaybackEntry | undefined {
  return entries.get(sessionId);
}

export function setExpoHlsPlaybackEntry(entry: ExpoHlsPlaybackEntry): void {
  const previous = entries.get(entry.sessionId);
  if (previous && previous.player !== entry.player) {
    try {
      previous.player.release();
    } catch {
      // Ignore release races when replacing a session.
    }
  }
  entries.set(entry.sessionId, entry);
  emitRegistry();
}

export function deleteExpoHlsPlaybackEntry(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entries.delete(sessionId);
  try {
    entry.player.pause();
    entry.player.release();
  } catch {
    // Best-effort cleanup.
  }
  emitRegistry();
}

export function subscribeExpoHlsPlayback(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitExpoHlsPlaybackEvent(event: NativePlaybackEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeExpoHlsRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function emitRegistry(): void {
  for (const listener of registryListeners) listener();
}