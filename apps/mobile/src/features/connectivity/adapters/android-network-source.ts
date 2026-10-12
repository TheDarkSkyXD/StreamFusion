import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

import type { NetworkRead } from "../capabilities/connectivity-session";

export async function readAndroidNetwork(): Promise<NetworkRead> {
  try {
    return (await getPlatformModule().getNetworkConnected()) ? "online" : "offline";
  } catch {
    return "online";
  }
}
