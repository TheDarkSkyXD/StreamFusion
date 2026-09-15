import {
  asMediaJobId,
  isMediaJobId,
  type MediaJobId,
} from "@streamfusion/core/media-jobs";

import type { WatchTarget } from "../capabilities/watch";

export type WatchDownloadEligibility =
  | { readonly kind: "hidden" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly jobId: MediaJobId;
      readonly kind: "eligible";
      readonly label: string;
    };

export function watchDownloadEligibility(
  target: WatchTarget,
): WatchDownloadEligibility {
  const media = target.media;
  if (!media) return { kind: "hidden" };
  if (media.kind === "clip" && target.platform === "kick") {
    return {
      kind: "unsupported",
      reason: "Kick clips are not available in this build.",
    };
  }
  if (!isClipOrVideo(media.kind)) return { kind: "hidden" };
  const jobId = downloadJobId(target.platform, media.kind, media.id);
  if (!jobId) {
    return {
      kind: "unsupported",
      reason: "This recording cannot be downloaded.",
    };
  }
  return {
    jobId,
    kind: "eligible",
    label: downloadLabel(media.kind),
  };
}

export function watchDownloadJobId(target: WatchTarget): MediaJobId | null {
  const eligibility = watchDownloadEligibility(target);
  return eligibility.kind === "eligible" ? eligibility.jobId : null;
}

function isClipOrVideo(kind: string): kind is "clip" | "video" {
  return kind === "clip" || kind === "video";
}

function downloadLabel(kind: "clip" | "video"): string {
  return kind === "clip" ? "Download clip" : "Download video";
}

function downloadJobId(
  platform: WatchTarget["platform"],
  kind: "clip" | "video",
  id: string,
): MediaJobId | null {
  const safeId = id.replace(/[^a-zA-Z0-9._:-]/gu, "-").slice(0, 200);
  const value = `dl-${platform}-${kind}-${safeId}`;
  return isMediaJobId(value) ? asMediaJobId(value) : null;
}
