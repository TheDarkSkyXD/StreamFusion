import { NavigationBar } from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Platform } from "react-native";

import { ANDROID_SYSTEM_CHROME_COLOR } from "../domain/android-system-chrome";

/**
 * Align Android root / navigation chrome with the bottom tab surface.
 *
 * Expo Go forces a transparent navigation bar under edge-to-edge; coloring the
 * root view still fills letterboxed strips outside the React tree. `setStyle`
 * keeps three-button icons light on our dark surface when contrast enforcement
 * is disabled via the expo-navigation-bar config plugin.
 */
export function applyAndroidSystemChrome(): void {
  if (Platform.OS !== "android") {
    return;
  }

  void SystemUI.setBackgroundColorAsync(ANDROID_SYSTEM_CHROME_COLOR).catch(
    () => {
      // Host may omit the module (tests / non-Expo runtimes).
    },
  );

  try {
    NavigationBar.setStyle("light");
  } catch {
    // Expo Go / unsupported hosts no-op.
  }
}
