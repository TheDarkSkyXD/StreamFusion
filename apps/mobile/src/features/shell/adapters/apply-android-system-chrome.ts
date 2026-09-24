import { Platform } from "react-native";

/**
 * Align Android root / navigation chrome with the bottom tab surface.
 *
 * Optional Expo modules (`expo-system-ui`, `expo-navigation-bar`) are omitted on
 * some development-client binaries. Requiring them throws a fatal RedBox even
 * inside try/catch, so this helper stays a no-op until those modules are linked.
 * Edge-to-edge / tab surface coloring continues via React Native theme tokens.
 */
export function applyAndroidSystemChrome(): void {
  if (Platform.OS !== "android") {
    return;
  }
}
