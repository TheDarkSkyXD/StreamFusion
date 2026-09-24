import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

export type WatchCaptionEligibility =
  | { readonly kind: "hidden" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly kind: "eligible";
      readonly sessionId: string;
      readonly label: string;
    };

/**
 * Player CC chrome is hidden until provider caption tracks ship with a go-ahead.
 * Never show Coming soon / Install model / disabled CC on Watch.
 */
export function watchCaptionEligibility(
  _target: WatchTarget,
  _captionsEnabled = true,
): WatchCaptionEligibility {
  return { kind: "hidden" };
}

export function watchCaptionSessionId(target: WatchTarget): string | null {
  const eligibility = watchCaptionEligibility(target);
  return eligibility.kind === "eligible" ? eligibility.sessionId : null;
}
