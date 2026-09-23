import { describe, expect, it } from "vitest";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import { resolveGuestLiveAlertTruthKeys } from "../domain/guest-live-alert-status";

describe("resolveGuestLiveAlertTruthKeys", () => {
  it("reports local system delivery when guest follows are on and permission is granted", () => {
    const truths = resolveGuestLiveAlertTruthKeys({
      permission: "granted",
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      remotePushAvailable: false,
    });
    expect(truths).toEqual({
      eligibilityKey: "eligibilityCan",
      permissionKey: "permissionGranted",
      registrationKey: "registrationRemoteUnavailable",
      deliveryKey: "deliveryLocalSystem",
      systemNotificationsKey: "systemLocalAlertsReady",
    });
  });

  it("keeps Expo Go registration as remote-unavailable while permission is still pending", () => {
    const truths = resolveGuestLiveAlertTruthKeys({
      permission: "not-requested",
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      remotePushAvailable: false,
    });
    expect(truths.registrationKey).toBe("registrationRemoteUnavailable");
    expect(truths.permissionKey).toBe("permissionNotRequested");
    expect(truths.deliveryKey).toBe("deliveryNeedsPermission");
    expect(truths.systemNotificationsKey).toBe(
      "systemLocalAlertsNeedPermission",
    );
  });

  it("marks eligibility off when Guest Follow notifications are disabled", () => {
    const truths = resolveGuestLiveAlertTruthKeys({
      permission: "granted",
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      remotePushAvailable: true,
    });
    expect(truths.eligibilityKey).toBe("eligibilityCannot");
    expect(truths.deliveryKey).toBe("deliveryInAppOnly");
    expect(truths.systemNotificationsKey).toBe("systemGuestFollowsOff");
    expect(truths.registrationKey).toBe("registrationNotRegistered");
  });
});
