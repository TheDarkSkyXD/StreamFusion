import type { NativeRegistrationSnapshot } from "../capabilities/native-notifications";

export const NOTIFICATION_RATE_LIMIT_FAILURE =
  "FCM rate-limited the send. StreamFusion retries after Retry-After. This is not a device receipt.";
export const NOTIFICATION_CREDENTIAL_ROTATION_FAILURE =
  "Relay FCM credentials rotated. The queue retries without dropping Activity.";

export function nativeRegistrationCopy(
  snapshot: Omit<NativeRegistrationSnapshot, "copy">,
): string {
  if (snapshot.state === "registered" && snapshot.fingerprint) {
    const reconciled =
      snapshot.overflowPairs > 0
        ? `Relay reconciled ${snapshot.topicSubscriptions} Live topics. ${snapshot.overflowPairs} overflow pairs keep direct-token delivery. Activity still records if a send fails.`
        : `Relay reconciled ${snapshot.topicSubscriptions} Live topics. Direct tokens stay private for media and account alerts.`;
    return snapshot.lastFailure
      ? `${reconciled} ${snapshot.lastFailure}`
      : reconciled;
  }
  if (snapshot.lastFailure) {
    return snapshot.lastFailure;
  }
  if (snapshot.state === "unavailable") {
    return "Remote FCM is unavailable here. Local live alerts still post when Android notifications are enabled. Activity history stays on.";
  }
  if (snapshot.state === "denied") {
    return "Android blocked notification posting. Activity history stays on. Retry the permission or open system settings.";
  }
  if (snapshot.state === "pending") {
    return "Native FCM registration is in progress.";
  }
  return "Native FCM registration starts when Android notifications are on.";
}

export function nativeRegistrationSnapshot(input: {
  readonly fingerprint: string | null;
  readonly lastFailure?: string | null;
  readonly overflowPairs?: number;
  readonly state: NativeRegistrationSnapshot["state"];
  readonly topicSubscriptions?: number;
}): NativeRegistrationSnapshot {
  const snapshot = {
    fingerprint: input.fingerprint,
    lastFailure: input.lastFailure ?? null,
    overflowPairs: input.overflowPairs ?? 0,
    state: input.state,
    topicSubscriptions: input.topicSubscriptions ?? 0,
  };
  return {
    ...snapshot,
    copy: nativeRegistrationCopy(snapshot),
  };
}
