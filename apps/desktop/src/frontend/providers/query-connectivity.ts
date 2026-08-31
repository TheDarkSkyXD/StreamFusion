import { onlineManager, type QueryClient } from "@tanstack/react-query";

import { networkStatusStore, type NetworkStatusStore } from "@/hooks/network-status-store";

export function configureConfirmedConnectivity(
  client: QueryClient,
  store: NetworkStatusStore = networkStatusStore
): void {
  onlineManager.setEventListener((setOnline) => {
    let previousStatus: "online" | "offline" | null = null;

    const syncConfirmedStatus = (): void => {
      const currentStatus = store.getSnapshot().confirmedStatus;
      if (currentStatus === "checking" || currentStatus === previousStatus) return;

      const recovered = previousStatus === "offline" && currentStatus === "online";
      previousStatus = currentStatus;
      setOnline(currentStatus === "online");

      if (recovered) void client.invalidateQueries({ refetchType: "active" });
    };

    const unsubscribe = store.subscribe(syncConfirmedStatus);
    syncConfirmedStatus();
    return unsubscribe;
  });
}
