/**
 * Static, extensionless deep imports of expo-notifications **local** APIs.
 *
 * Do not import the package root from this file: `build/index.js` re-exports
 * `DevicePushTokenAutoRegistration.fx` / `TokenEmitter`, and those evaluate
 * `requireNativeModule("ExpoPushTokenManager")` + Expo Go push guards that
 * break Android Expo Go (SDK 53+).
 *
 * Keep these imports static (no `import("…/build/*.js")`). Dynamic deep imports
 * of package build paths have produced Metro "Requiring unknown module NNNN"
 * redboxes in Expo Go even when bundling appeared to start — the same failure
 * class as `import("expo-network")`.
 */

export { setNotificationChannelAsync } from "expo-notifications/build/setNotificationChannelAsync";
export { AndroidImportance } from "expo-notifications/build/NotificationChannelManager.types";
export {
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-notifications/build/NotificationPermissions";
export { scheduleNotificationAsync } from "expo-notifications/build/scheduleNotificationAsync";
export {
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
} from "expo-notifications/build/NotificationsEmitter";
export { setNotificationHandler } from "expo-notifications/build/NotificationsHandler";
