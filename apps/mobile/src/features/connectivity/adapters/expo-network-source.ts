import type { NetworkRead } from "../capabilities/connectivity-session";

/**
 * Lazily reads network state. Avoids a top-level `expo-network` import because
 * that package calls requireNativeModule("ExpoNetwork") at module load and can
 * throw before any try/catch (mismatched Expo Go / stripped hosts).
 */
export async function readExpoNetwork(): Promise<NetworkRead> {
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
