import type { NativeRegistrationSnapshot } from "../capabilities/native-notifications";

export function nativeRegistrationCopy(
  snapshot: Omit<NativeRegistrationSnapshot, "copy">,
): string {
  if (snapshot.state === "registered" && snapshot.fingerprint) {
    const reconciled =
      "This device is registered for background delivery. Saved alert choices control what is sent.";
    return snapshot.lastFailure
      ? `${reconciled} ${snapshot.lastFailure}`
      : reconciled;
  }
  if (snapshot.lastFailure) {
    return snapshot.lastFailure;
  }
  if (snapshot.state === "unavailable") {
    return "Background alerts are unavailable until this device registers. Live Notification history remains on.";
  }
  if (snapshot.state === "denied") {
    return "Android blocked notification posting. Activity history stays on. Retry the permission or open system settings.";
  }
  if (snapshot.state === "pending") {
    return "Registering this device for background alerts.";
  }
  return "Background alert registration has not started yet.";
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
