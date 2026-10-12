import { Linking, Platform } from "react-native";

import { getNativeNotifications } from "../../notifications/adapters/android-notifications-module";

import type {
  NotificationPermissionPort,
  NotificationPermissionSnapshot,
  NotificationPermissionStatus,
} from "../capabilities/notification-settings";

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
  try {
    const notifications = getNativeNotifications();
    const status = request
      ? await notifications.requestPermission()
      : await notifications.getPermissionStatus();
    return { apiLevel, permission: permissionFromStatus(status) };
  } catch {
    return { apiLevel, permission: "unavailable" };
  }
}

export function permissionFromStatus(status: string): NotificationPermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  if (status === "not-requested") return "not-requested";
  return "unavailable";
}
