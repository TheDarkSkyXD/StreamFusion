import { Linking, PermissionsAndroid, Platform, type Permission } from "react-native";

import type {
  NotificationPermissionPort,
  NotificationPermissionSnapshot,
  NotificationPermissionStatus,
} from "../capabilities/notification-settings";

const RUNTIME_PERMISSION_API = 33;

export function createAndroidNotificationPermissionPort(): NotificationPermissionPort {
  return {
    openSystemSettings: () => Linking.openSettings(),
    read: readNotificationPermission,
    request: requestNotificationPermission,
  };
}

async function readNotificationPermission(): Promise<NotificationPermissionSnapshot> {
  return permissionSnapshot(async (name) => {
    const allowed = await PermissionsAndroid.check(name);
    return allowed ? "granted" : "denied";
  });
}

async function requestNotificationPermission(): Promise<NotificationPermissionSnapshot> {
  return permissionSnapshot(async (name) =>
    permissionFromResult(
      await PermissionsAndroid.request(name, {
        title: "Live alerts",
        message: "StreamFusion posts live alerts when a followed channel goes live.",
        buttonPositive: "Allow",
        buttonNegative: "Deny",
      }),
    ),
  );
}

async function permissionSnapshot(
  whenPromptable: (name: Permission) => Promise<NotificationPermissionStatus>,
): Promise<NotificationPermissionSnapshot> {
  const apiLevel = androidApiLevel();
  if (apiLevel < RUNTIME_PERMISSION_API) {
    return { apiLevel, permission: "granted" };
  }
  const name = postNotificationsPermission();
  if (!name) return { apiLevel, permission: "unavailable" };
  return { apiLevel, permission: await whenPromptable(name) };
}

function androidApiLevel(): number {
  return Number(Platform.Version);
}

function postNotificationsPermission(): Permission | null {
  return PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ?? null;
}

function permissionFromResult(result: string): NotificationPermissionStatus {
  if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
  if (
    result === PermissionsAndroid.RESULTS.DENIED ||
    result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
  ) {
    return "denied";
  }
  return "unavailable";
}
