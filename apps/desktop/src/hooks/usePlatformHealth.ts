/**
 * Renderer-side per-Platform health subscription. Hydrates from
 * `electronAPI.platformHealth.get()` on mount and subscribes to transition
 * pushes. `anyDegraded` is true for any non-healthy state (degraded or down).
 */

import { useEffect, useState } from "react";

import type { PlatformHealth } from "@/backend/api/unified/platform-health";

interface PlatformHealthState {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  anyDegraded: boolean;
}

const INITIAL_STATE: PlatformHealthState = {
  kick: "healthy",
  twitch: "healthy",
  anyDegraded: false,
};

function derive(kick: PlatformHealth, twitch: PlatformHealth): PlatformHealthState {
  return {
    kick,
    twitch,
    anyDegraded: kick !== "healthy" || twitch !== "healthy",
  };
}

export function usePlatformHealth(): PlatformHealthState {
  const [state, setState] = useState<PlatformHealthState>(INITIAL_STATE);

  useEffect(() => {
    const bridge = window.electronAPI?.platformHealth;
    if (!bridge) return;

    let cancelled = false;

    void bridge.get().then((snapshot) => {
      if (cancelled) return;
      setState(derive(snapshot.kick, snapshot.twitch));
    });

    const unsubscribe = bridge.onChange((event) => {
      setState((prev) => {
        const next = { kick: prev.kick, twitch: prev.twitch };
        next[event.platform] = event.status;
        return derive(next.kick, next.twitch);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
