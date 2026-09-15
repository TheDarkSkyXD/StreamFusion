import type { NativeRegistrationSnapshot } from "../capabilities/native-notifications";

export function nativeRegistrationCopy(
  snapshot: Omit<NativeRegistrationSnapshot, "copy">,
): string {
  if (snapshot.state === "registered" && snapshot.fingerprint) {
    return `Native FCM token fingerprint ${snapshot.fingerprint}. Topic fanout waits until later notification delivery.`;
  }
  if (snapshot.state === "unavailable") {
    return "Native FCM registration is unavailable on this device. Activity and local channels still work.";
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
  readonly state: NativeRegistrationSnapshot["state"];
}): NativeRegistrationSnapshot {
  return {
    copy: nativeRegistrationCopy(input),
    fingerprint: input.fingerprint,
    state: input.state,
  };
}
