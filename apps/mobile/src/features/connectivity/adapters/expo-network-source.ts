import { getNetworkStateAsync } from "expo-network";

import type { NetworkRead } from "../capabilities/connectivity-session";

export async function readExpoNetwork(): Promise<NetworkRead> {
  try {
    const state = await getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return "offline";
    }
    return "online";
  } catch {
    return "offline";
  }
}
