import { Appearance, StatusBar } from "react-native";
import {
  nativeColorScheme,
  type ThemePreference,
} from "@streamfusion/core/settings";

export function applyAppearanceScheme(theme: ThemePreference): void {
  const scheme = nativeColorScheme(theme);
  Appearance.setColorScheme(scheme);
  const resolved =
    scheme === "auto" ? (Appearance.getColorScheme() ?? "dark") : scheme;
  StatusBar.setBarStyle(resolved === "light" ? "dark-content" : "light-content");
}
