/**
 * Renderer-side per-Platform health subscription. Hydrates from
 * `electronAPI.platformHealth.get()` on mount and subscribes to transition
 * pushes. `anyDegraded` is true for any non-healthy state (degraded or down).
 */

import { useEffect, useState } from "react";

import type { PlatformHealth, StatusPageDetail } from "@/backend/api/unified/platform-health";
import { invalidatePlatformRecoveryCaches } from "@/hooks/queries/cache-invalidation";
import { queryClient } from "@/providers/query-provider";

interface PlatformHealthState {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  anyDegraded: boolean;
  details: {
    kick?: StatusPageDetail;
    twitch?: StatusPageDetail;
  };
}

const INITIAL_STATE: PlatformHealthState = {
  kick: "healthy",
  twitch: "healthy",
  anyDegraded: false,
  details: {},
};

function derive(
  kick: PlatformHealth,
  twitch: PlatformHealth,
  details: PlatformHealthState["details"] = {}
): PlatformHealthState {
  return {
    kick,
    twitch,
    anyDegraded: kick !== "healthy" || twitch !== "healthy",
    details,
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
      setState(derive(snapshot.kick, snapshot.twitch, snapshot.details ?? {}));
    });

    const unsubscribe = bridge.onChange((event) => {
      if (event.status === "healthy") {
        invalidatePlatformRecoveryCaches(queryClient, event.platform);
      }

      setState((prev) => {
        const next = { kick: prev.kick, twitch: prev.twitch };
        next[event.platform] = event.status;
        const details = { ...prev.details };
        if (event.status === "healthy") {
          delete details[event.platform];
        } else if (event.statusPageDetail != null) {
          details[event.platform] = event.statusPageDetail;
        }
        return derive(next.kick, next.twitch, details);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
