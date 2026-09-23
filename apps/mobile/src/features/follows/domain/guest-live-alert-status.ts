import type { LiveNotificationPreferences } from "@streamfusion/core/follows";

import type { NotificationPermissionStatus } from "@mobile/features/settings/capabilities/notification-settings";

/** i18n key suffixes under discovery.following.* for Manage Guest Follow status. */
export type GuestLiveAlertTruthKeys = {
  readonly eligibilityKey: "eligibilityCan" | "eligibilityCannot";
  readonly permissionKey:
    | "permissionGranted"
    | "permissionDenied"
    | "permissionNotRequested"
    | "permissionUnavailable";
  readonly registrationKey:
    | "registrationRemoteUnavailable"
    | "registrationNotRegistered";
  readonly deliveryKey:
    | "deliveryLocalSystem"
    | "deliveryInAppOnly"
    | "deliveryNeedsPermission";
  readonly systemNotificationsKey:
    | "systemLocalAlertsReady"
    | "systemLocalAlertsNeedPermission"
    | "systemGuestFollowsOff";
};

/**
 * Live Manage-screen status for Guest Follow go-live alerts.
 * Local system notifications work in Expo Go when permission is granted;
 * remote FCM registration does not.
 */
export function resolveGuestLiveAlertTruthKeys(input: {
  readonly preferences: LiveNotificationPreferences;
  readonly permission: NotificationPermissionStatus;
  readonly remotePushAvailable: boolean;
}): GuestLiveAlertTruthKeys {
  const guestOn = input.preferences.guestFollows;
  const systemOn = input.preferences.enabled;
  const canDeliverLocal =
    guestOn && systemOn && input.permission === "granted";
  const deliveryKey = !guestOn || !systemOn
    ? "deliveryInAppOnly"
    : canDeliverLocal
      ? "deliveryLocalSystem"
      : input.permission === "denied" || input.permission === "not-requested"
        ? "deliveryNeedsPermission"
        : "deliveryInAppOnly";

  return {
    eligibilityKey: guestOn ? "eligibilityCan" : "eligibilityCannot",
    permissionKey: permissionKey(input.permission),
    registrationKey: input.remotePushAvailable
      ? "registrationNotRegistered"
      : "registrationRemoteUnavailable",
    deliveryKey,
    systemNotificationsKey: !guestOn
      ? "systemGuestFollowsOff"
      : canDeliverLocal
        ? "systemLocalAlertsReady"
        : "systemLocalAlertsNeedPermission",
  };
}

function permissionKey(
  permission: NotificationPermissionStatus,
): GuestLiveAlertTruthKeys["permissionKey"] {
  switch (permission) {
    case "granted":
      return "permissionGranted";
    case "denied":
      return "permissionDenied";
    case "not-requested":
      return "permissionNotRequested";
    case "unavailable":
      return "permissionUnavailable";
  }
}
