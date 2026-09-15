import * as Notifications from "expo-notifications";
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
    read: () => snapshotPermission(() => Notifications.getPermissionsAsync()),
    request: () =>
      snapshotPermission(() => Notifications.requestPermissionsAsync()),
  };
}

async function snapshotPermission(
  query: () => Promise<{ readonly status: string }>,
): Promise<NotificationPermissionSnapshot> {
  const apiLevel = Number(Platform.Version);
  if (apiLevel < RUNTIME_PERMISSION_API) {
    return { apiLevel, permission: "granted" };
  }
  const existing = await query();
  return { apiLevel, permission: permissionFromStatus(existing.status) };
}

function permissionFromStatus(status: string): NotificationPermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "unavailable";
}
