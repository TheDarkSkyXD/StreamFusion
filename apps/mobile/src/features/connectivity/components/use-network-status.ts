import { useCallback, useEffect, useState } from "react";

import type { MobileConnectivityStatus } from "@mobile/design/connectivity-banner";
import type { NetworkRead } from "../capabilities/connectivity-session";

const POLL_MS = 8_000;

/**
 * Shell-level network status for the connectivity banner.
 * Polls readNetwork so the banner stays honest across tabs without blocking UI.
 */
export function useNetworkStatus(input: {
  readonly enabled?: boolean;
  readonly readNetwork: () => Promise<NetworkRead>;
}): {
  readonly status: MobileConnectivityStatus;
  readonly refresh: () => Promise<void>;
} {
  const enabled = input.enabled !== false;
  const readNetwork = input.readNetwork;
  const [status, setStatus] = useState<MobileConnectivityStatus>("online");

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus("online");
      return;
    }
    setStatus((current) => (current === "offline" ? "checking" : current));
    try {
      const next = await readNetwork();
      setStatus(next);
    } catch {
      setStatus("offline");
    }
  }, [enabled, readNetwork]);

  useEffect(() => {
    if (!enabled) {
      setStatus("online");
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await readNetwork();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, readNetwork]);

  return { refresh, status };
}
