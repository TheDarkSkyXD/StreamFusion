import { Appearance, StatusBar } from "react-native";

import { applyAndroidSystemChrome } from "@mobile/features/shell/adapters/apply-android-system-chrome";

export function applyAppearanceScheme(): void {
  Appearance.setColorScheme("dark");
  StatusBar.setBarStyle("light-content");
  applyAndroidSystemChrome();
}
