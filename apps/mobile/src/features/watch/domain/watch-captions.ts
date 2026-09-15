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
  target: WatchTarget,
  captionsEnabled = true,
): WatchCaptionEligibility {
  if (!captionsEnabled || target.media) return { kind: "hidden" };
  const sessionId = captionSessionId(target.platform, target.channelId);
  if (!sessionId) {
    return {
      kind: "unsupported",
      reason: "This live stream cannot use local captions.",
    };
  }
  return {
    kind: "eligible",
    label: "Captions",
    sessionId,
  };
}

export function watchCaptionSessionId(target: WatchTarget): string | null {
  const eligibility = watchCaptionEligibility(target);
  return eligibility.kind === "eligible" ? eligibility.sessionId : null;
}

function captionSessionId(
  platform: WatchTarget["platform"],
  channelId: string,
): string | null {
  const safeId = channelId.replace(/[^a-zA-Z0-9._:-]/gu, "-").slice(0, 200);
  const value = `cap-${platform}-${safeId}`;
  return value.length > 0 ? value : null;
}
