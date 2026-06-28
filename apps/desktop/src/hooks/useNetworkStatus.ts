import { useEffect, useState } from "react";

const NETWORK_STATUS_OVERRIDE_EVENT = "streamfusion:network-status-override";

export interface NetworkStatus {
  isOnline: boolean;
  isOffline: boolean;
}

type NetworkStatusOverrideEvent = CustomEvent<{ isOnline: boolean | null }>;

function readOnlineState(): boolean {
  const w = (globalThis as unknown as { window?: Window }).window;
  return w?.navigator.onLine ?? true;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(readOnlineState);

  useEffect(() => {
    const w = (globalThis as unknown as { window?: Window }).window;
    if (!w) return;

    let overrideOnline: boolean | null = null;
    const update = (): void => setIsOnline(overrideOnline ?? readOnlineState());
    const updateFromOverride = (event: Event): void => {
      overrideOnline = (event as NetworkStatusOverrideEvent).detail.isOnline;
      setIsOnline(overrideOnline ?? readOnlineState());
    };

    w.addEventListener("online", update);
    w.addEventListener("offline", update);
    w.addEventListener(NETWORK_STATUS_OVERRIDE_EVENT, updateFromOverride);

    return () => {
      w.removeEventListener("online", update);
      w.removeEventListener("offline", update);
      w.removeEventListener(NETWORK_STATUS_OVERRIDE_EVENT, updateFromOverride);
    };
  }, []);

  return { isOnline, isOffline: !isOnline };
}

export function setNetworkStatusOverrideForDebug(isOnline: boolean | null): void {
  const w = (globalThis as unknown as { window?: Window }).window;
  w?.dispatchEvent(
    new CustomEvent(NETWORK_STATUS_OVERRIDE_EVENT, {
      detail: { isOnline },
    })
  );
}
