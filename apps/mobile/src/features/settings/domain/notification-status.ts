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
const DENIED_PERMISSION_COPY =
  "Android blocked notification posting. Activity history stays on. Retry the permission or open system settings.";
const NOTIFICATION_LIFECYCLE_COPY =
  "Live alerts use your saved follows and notification choices. Notification history remains available when Android posting is off.";

export function notificationLifecycleCopy(): string {
  return NOTIFICATION_LIFECYCLE_COPY;
}

export function notificationPermissionCopy(
  permission: NotificationPermissionStatus,
  apiLevel: number,
): string {
  if (apiLevel < RUNTIME_PERMISSION_API) {
    return "This Android version posts notifications without a runtime prompt. Retry stays available if a later OS denies posting.";
  }
  switch (permission) {
    case "denied":
      return DENIED_PERMISSION_COPY;
    case "not-requested":
      return "Notification permission has not been requested yet. Turn on Android or Guest Follow notifications to prompt, or open system settings.";
    case "unavailable":
      return "Notification permission is unavailable on this device. Activity history still records eligible live events.";
    case "granted":
      return "Android allows notification posting on this device.";
  }
}

export function notificationDeliveryCopy(input: {
  readonly network: NotificationNetwork;
  readonly permission: NotificationPermissionStatus;
  readonly preferences: LiveNotificationPreferences;
}): string {
  const { network, permission, preferences } = input;
  if (preferences.enabled && permission === "denied") {
    return "Live Notification history remains available. Android posting is denied until retry succeeds.";
  }
  if (!preferences.enabled || preferences.doNotDisturb) {
    return "Live Notification history stays available. Android live alerts are off.";
  }
  if (!preferences.liveAlerts) {
    return "Activity does not create live-alert rows. Android posting stays independent.";
  }
  if (network === "offline") {
    return "Preferences save on this device. Relay registration waits until the network returns.";
  }
  if (
    preferences.enabled &&
    preferences.guestFollows &&
    permission === "granted"
  ) {
    return "Guest Follow live alerts are eligible on this device. Background delivery depends on device registration.";
  }
  return "Followed live channels can create alerts when their notification choices are enabled.";
}

function nativeRegistrationFallback(input: {
  readonly permission: NotificationPermissionStatus;
  readonly preferences: LiveNotificationPreferences;
}): string {
  if (input.permission === "denied") {
    return DENIED_PERMISSION_COPY;
  }
  if (!input.preferences.enabled) {
    return "Android live alerts are off. Live Notification history stays available.";
  }
  return "Checking background alert registration on this device.";
}

export function composeNotificationSettingsView(input: {
  readonly apiLevel: number;
  readonly network: NotificationNetwork;
  readonly permission: NotificationPermissionStatus;
  readonly preferences: LiveNotificationPreferences;
  readonly registrationCopy?: string;
}): NotificationSettingsView {
  const { apiLevel, network, permission, preferences, registrationCopy } =
    input;
  return {
    apiLevel,
    deliveryCopy: notificationDeliveryCopy({
      network,
      permission,
      preferences,
    }),
    denied: permission === "denied",
    lifecycleCopy: NOTIFICATION_LIFECYCLE_COPY,
    network,
    permission,
    permissionCopy: notificationPermissionCopy(permission, apiLevel),
    preferences,
    registrationCopy:
      registrationCopy ??
      nativeRegistrationFallback({ permission, preferences }),
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
