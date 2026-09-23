import { isRunningInExpoGo } from "expo";
import { Linking, Platform } from "react-native";

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
  // Avoid importing/touching expo-notifications push paths on Expo Go Android.
  if (isRunningInExpoGo()) {
    return { apiLevel, permission: "unavailable" };
  }
  try {
    const Notifications = await import("expo-notifications");
    const existing = request
      ? await Notifications.requestPermissionsAsync()
      : await Notifications.getPermissionsAsync();
    return { apiLevel, permission: permissionFromStatus(existing.status) };
  } catch {
    return { apiLevel, permission: "unavailable" };
  }
}

function permissionFromStatus(status: string): NotificationPermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "unavailable";
}
