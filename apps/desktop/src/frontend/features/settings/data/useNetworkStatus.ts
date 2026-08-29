import { useSyncExternalStore } from "react";

import {
  networkStatusStore,
  type ConnectivityObservation,
  type NetworkStatusSnapshot,
} from "@/hooks/network-status-store";

export interface NetworkStatus extends NetworkStatusSnapshot {
  checkNow: () => Promise<ConnectivityObservation>;
}

export function useNetworkStatus(): NetworkStatus {
  const snapshot = useSyncExternalStore(
    networkStatusStore.subscribe,
    networkStatusStore.getSnapshot,
    networkStatusStore.getSnapshot
  );

  return {
    ...snapshot,
    checkNow: networkStatusStore.checkNow,
  };
}

export function setNetworkStatusOverrideForDebug(isOnline: boolean | null): void {
  networkStatusStore.setDebugOverride(isOnline);
}
