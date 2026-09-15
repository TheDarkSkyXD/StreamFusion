import {
  asMediaJobId,
  isMediaJobId,
  type MediaJobId,
} from "@streamfusion/core/media-jobs";

import type { WatchTarget } from "../capabilities/watch";

export type WatchRecordingEligibility =
  | { readonly kind: "hidden" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly jobId: MediaJobId;
      readonly kind: "eligible";
      readonly label: string;
    };

export function watchRecordingEligibility(
  target: WatchTarget,
): WatchRecordingEligibility {
  if (target.media) return { kind: "hidden" };
  const jobId = recordingJobId(target.platform, target.channelId);
  if (!jobId) {
    return {
      kind: "unsupported",
      reason: "This live stream cannot be recorded.",
    };
  }
  return {
    jobId,
    kind: "eligible",
    label: "Record",
  };
}

export function watchRecordingJobId(target: WatchTarget): MediaJobId | null {
  const eligibility = watchRecordingEligibility(target);
  return eligibility.kind === "eligible" ? eligibility.jobId : null;
}

function recordingJobId(
  platform: WatchTarget["platform"],
  channelId: string,
): MediaJobId | null {
  const safeId = channelId.replace(/[^a-zA-Z0-9._:-]/gu, "-").slice(0, 200);
  const value = `rec-${platform}-${safeId}`;
  return isMediaJobId(value) ? asMediaJobId(value) : null;
}
