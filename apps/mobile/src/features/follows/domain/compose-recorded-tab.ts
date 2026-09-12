import type { Platform } from "@streamfusion/core/platform";

import type {
  FollowedRecordedOutcome,
  FollowingChip,
  FollowingTab,
  TabItems,
} from "../capabilities/following-session";
import type { GuestFollow } from "@streamfusion/core/follows";
import { recordedVisible } from "./following-filters";

export function composeRecordedTab<
  T extends { readonly platform: Platform; readonly title: string },
>(input: {
  readonly activeTab: "videos" | "clips";
  readonly chip: FollowingChip;
  readonly loadingRecorded: boolean;
  readonly membership: readonly GuestFollow[];
  readonly query: string;
  readonly recorded?: readonly FollowedRecordedOutcome<T>[];
  readonly tab: FollowingTab;
}): TabItems<T> {
  if (input.membership.length === 0) {
    return { kind: "empty", reason: "no-membership" };
  }
  if (input.tab !== input.activeTab) {
    return { kind: "empty", reason: "no-matches" };
  }
  if (input.loadingRecorded) return { kind: "loading" };
  const recorded = input.recorded ?? [];
  if (recorded.length === 0) {
    return { kind: "empty", reason: "no-matches" };
  }
  return recordedCollection(input, recorded);
}

function recordedCollection<
  T extends { readonly platform: Platform; readonly title: string },
>(
  input: {
    readonly chip: FollowingChip;
    readonly membership: readonly GuestFollow[];
    readonly query: string;
  },
  recorded: readonly FollowedRecordedOutcome<T>[],
): TabItems<T> {
  const supported = recorded.filter((outcome) => outcome.supported);
  if (supported.length === 0) {
    return {
      items: [],
      kind: "unsupported",
      reason: `${recorded[0]?.platform ?? "kick"}-recorded-unsupported`,
    };
  }
  const failed = supported.filter((outcome) => outcome.failed);
  const items = recordedVisible(
    supported.flatMap((outcome) => (outcome.failed ? [] : [...outcome.items])),
    input.chip,
    input.query,
  );
  if (failed.length === supported.length) {
    return {
      items: [],
      kind: "failed",
      offline: failed.some((outcome) => outcome.offline),
      retryablePlatforms: uniquePlatforms(failed),
    };
  }
  if (failed.length > 0) {
    return {
      failedPlatforms: uniquePlatforms(failed),
      items,
      kind: "partial",
      stale: supported.some((outcome) => outcome.stale),
    };
  }
  if (items.length === 0) {
    return { kind: "empty", reason: "no-matches" };
  }
  return {
    items,
    kind: "ready",
    stale: supported.some((outcome) => outcome.stale),
  };
}

function uniquePlatforms(
  outcomes: readonly { readonly platform: Platform }[],
): readonly Platform[] {
  return [...new Set(outcomes.map((outcome) => outcome.platform))];
}
