import type {
  FocusedPlaybackProtection,
  FocusedPlaybackProtectionPort,
} from "../capabilities/watch";

const NORMAL_PROTECTION: FocusedPlaybackProtection = { kind: "normal" };

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
      return NORMAL_PROTECTION;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
