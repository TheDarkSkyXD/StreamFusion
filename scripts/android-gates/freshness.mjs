const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function maximumAgeMilliseconds(freshnessClass, maximumAge) {
  const values = {
    "exact-artifact": maximumAge.exactArtifactHours * HOUR,
    "live-provider": maximumAge.liveProviderHours * HOUR,
    emulator: maximumAge.emulatorHours * HOUR,
    "physical-device": maximumAge.physicalDeviceDays * DAY,
    accessibility: maximumAge.accessibilityDays * DAY,
    "human-review": maximumAge.humanReviewDays * DAY,
  };
  if (freshnessClass !== "signer-recovery") return values[freshnessClass];
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + maximumAge.signerRecoveryMonths);
  return date.getTime() - Date.now();
}

function signerRecoveryExpiry(observedAt, months) {
  const date = new Date(observedAt);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

export function isFresh(slot, record, now, policy) {
  const observedAt = Date.parse(record.observedAt);
  const evaluatedAt = Date.parse(now);
  if (!Number.isFinite(observedAt) || !Number.isFinite(evaluatedAt)) return false;
  if (slot.freshnessClass === "signer-recovery") {
    return evaluatedAt <= signerRecoveryExpiry(
      observedAt,
      policy.maximumAge.signerRecoveryMonths,
    );
  }
  return evaluatedAt - observedAt <= maximumAgeMilliseconds(
    slot.freshnessClass,
    policy.maximumAge,
  );
}

export function matchesBinding(slot, record, { apkDigest, sourceCommit }) {
  if (slot.binding === "none") return true;
  if (slot.binding === "commit") return record.sourceCommit === sourceCommit;
  return apkDigest !== null && record.apkDigest === apkDigest;
}

export function f04Result(fill) {
  return fill.kind === "absent" ? "fail" : fill.kind;
}

export function retryWasUsed(record) {
  return record?.testVersion.includes("retry=used") ?? false;
}
