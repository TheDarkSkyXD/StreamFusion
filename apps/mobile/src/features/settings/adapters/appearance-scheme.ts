import { Appearance, StatusBar } from "react-native";

export function applyAppearanceScheme(): void {
  Appearance.setColorScheme("dark");
  StatusBar.setBarStyle("light-content");
}
