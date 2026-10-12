import { Platform } from "react-native";

import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";
import { ANDROID_SYSTEM_CHROME_COLOR } from "../domain/android-system-chrome";

export function applyAndroidSystemChrome(): void {
  if (Platform.OS !== "android") return;
  void getPlatformModule().setSystemChromeColor(ANDROID_SYSTEM_CHROME_COLOR).catch(() => undefined);
}
