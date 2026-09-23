import { isRunningInExpoGo } from "expo";

import type { NetworkRead } from "../capabilities/connectivity-session";

/**
 * Lazily reads network state. Never top-level-import `expo-network`: that
 * package calls requireNativeModule("ExpoNetwork") at module load. Metro can
 * also redbox dynamic import failures ("unknown module") even inside try/catch,
 * so Expo Go skips the import entirely and assumes online.
 */
export async function readExpoNetwork(): Promise<NetworkRead> {
  if (isRunningInExpoGo()) {
    return "online";
  }
  try {
    const { getNetworkStateAsync } = await import("expo-network");
    const state = await getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return "offline";
    }
    return "online";
  } catch {
    // Missing native module or import failure — assume online so the Offline
    // banner does not false-positive in Expo Go / test hosts.
    return "online";
  }
}
