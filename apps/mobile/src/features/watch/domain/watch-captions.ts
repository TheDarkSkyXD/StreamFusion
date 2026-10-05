import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

export type WatchCaptionEligibility =
  | { readonly kind: "hidden" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly kind: "eligible";
      readonly sessionId: string;
      readonly label: string;
    };

export function watchCaptionEligibility(
  _target: WatchTarget,
  captionsEnabled = true,
  activeSessionId?: string,
): WatchCaptionEligibility {
  if (!captionsEnabled) return { kind: "hidden" };
  if (!activeSessionId) {
    return {
      kind: "unsupported",
      reason:
        "Local captions need a playing stream in the Android native client.",
    };
  }
  return {
    kind: "eligible",
    label: "Local captions",
    sessionId: activeSessionId,
  };
}

export function watchCaptionSessionId(
  target: WatchTarget,
  activeSessionId?: string,
): string | null {
  const eligibility = watchCaptionEligibility(target, true, activeSessionId);
  return eligibility.kind === "eligible" ? eligibility.sessionId : null;
}
