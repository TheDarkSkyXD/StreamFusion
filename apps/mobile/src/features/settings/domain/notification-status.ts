import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  getLiveNotificationPreferences,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import type {
  NotificationNetwork,
  NotificationPermissionStatus,
  NotificationPreferencePatch,
  NotificationSettingsView,
} from "../capabilities/notification-settings";

const RUNTIME_PERMISSION_API = 33;

export function composeNotificationSettingsView(input: {
  readonly apiLevel: number;
  readonly network: NotificationNetwork;
  readonly permission: NotificationPermissionStatus;
  readonly preferences: LiveNotificationPreferences;
}): NotificationSettingsView {
  const { apiLevel, network, permission, preferences } = input;
  return {
    apiLevel,
    deliveryCopy: notificationDeliveryCopy({ network, permission, preferences }),
    denied: permission === "denied",
    network,
    permission,
    permissionCopy: notificationPermissionCopy(permission, apiLevel),
    preferences,
  };
}

export function defaultNotificationSettingsView(): NotificationSettingsView {
  return composeNotificationSettingsView({
    apiLevel: 30,
    network: "online",
    permission: "granted",
    preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  });
}

export function mergeNotificationPreferences(
  current: LiveNotificationPreferences,
  patch: NotificationPreferencePatch,
): LiveNotificationPreferences {
  return getLiveNotificationPreferences({ ...current, ...patch });
}

export function notificationPermissionCopy(
  permission: NotificationPermissionStatus,
  apiLevel: number,
): string {
  if (apiLevel < RUNTIME_PERMISSION_API) {
    return "This Android version posts notifications without a runtime prompt. Retry stays available if a later OS denies posting.";
  }
  if (permission === "denied") {
    return "Android blocked notification posting. Activity history stays on. Retry the permission or open system settings.";
  }
  if (permission === "unavailable") {
    return "Notification permission is unavailable on this device. Activity history still records eligible live events.";
  }
  return "Android allows notification posting. Remote FCM delivery waits until native registration ships.";
}

export function notificationDeliveryCopy(input: {
  readonly network: NotificationNetwork;
  readonly permission: NotificationPermissionStatus;
  readonly preferences: LiveNotificationPreferences;
}): string {
  const { network, permission, preferences } = input;
  if (network === "offline") {
    return "Preferences save on this device. Relay registration waits until the network returns.";
  }
  if (preferences.enabled && permission === "denied") {
    return "Live Notification history stays active. Android posting is denied until retry succeeds.";
  }
  if (!preferences.liveAlerts) {
    return "Activity does not create live-alert rows. Android posting stays independent.";
  }
  return "Guest Follow live alerts stay eligible on this device. Remote push registration is not on this build.";
}
