import type {
  FocusedPlaybackProtection,
  FocusedPlaybackProtectionPort,
} from "../capabilities/watch";

export function createMemoryPlaybackProtection(): FocusedPlaybackProtectionPort {
  const held = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    acquire(sessionId) {
      held.add(sessionId);
      return {
        release() {
          held.delete(sessionId);
        },
      };
    },
    snapshot(): FocusedPlaybackProtection {
      return { kind: "normal" };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
