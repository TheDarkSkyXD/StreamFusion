import { Linking, Platform } from "react-native";

import { loadExpoLocalNotifications } from "../../notifications/adapters/expo-local-notifications-module";

import type {
  NotificationPermissionPort,
  NotificationPermissionSnapshot,
  NotificationPermissionStatus,
} from "../capabilities/notification-settings";

const RUNTIME_PERMISSION_API = 33;

export function createAndroidNotificationPermissionPort(): NotificationPermissionPort {
  return {
    openSystemSettings: () => Linking.openSettings(),
    read: () => snapshotPermission(),
    request: () => snapshotPermission(true),
  };
}

async function snapshotPermission(
  request = false,
): Promise<NotificationPermissionSnapshot> {
  const apiLevel = Number(Platform.Version);
  if (apiLevel < RUNTIME_PERMISSION_API) {
    return { apiLevel, permission: "granted" };
  }
  // Deep-import local permission APIs so Expo Go Android can prompt without
  // loading DevicePushTokenAutoRegistration (package-root import throws).
  try {
    const Notifications = await loadExpoLocalNotifications();
    if (!Notifications) {
      return { apiLevel, permission: "unavailable" };
    }
    const existing = request
      ? await Notifications.requestPermissionsAsync()
      : await Notifications.getPermissionsAsync();
    return { apiLevel, permission: permissionFromStatus(existing.status) };
  } catch {
    return { apiLevel, permission: "unavailable" };
  }
}

export function permissionFromStatus(status: string): NotificationPermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  if (status === "undetermined") return "not-requested";
  return "unavailable";
}
