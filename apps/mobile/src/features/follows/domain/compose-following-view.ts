import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import {
  isPerChannelLiveNotificationEnabled,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";
import { PLATFORMS, type Platform } from "@streamfusion/core/platform";

import type {
  EmptyReason,
  FollowedReadOutcome,
  FollowedRecordedOutcome,
  FollowingChannelRow,
  FollowingChip,
  FollowingTab,
  FollowingView,
  TabItems,
} from "../capabilities/following-session";
import {
  filterByChip,
  filterStreams,
  liveStreamFor,
  recordedVisible,
} from "./following-filters";
import { matchesQuery } from "../utils/following-query";

export function composeFollowingView(input: {
  readonly chip: FollowingChip;
  readonly loadingLive: boolean;
  readonly loadingRecorded: boolean;
  readonly membership: readonly GuestFollow[];
  readonly notifications: LiveNotificationPreferences;
  readonly query: string;
  readonly recorded?: FollowedRecordedOutcome<Video> | FollowedRecordedOutcome<Clip>;
  readonly tab: FollowingTab;
  readonly kick?: FollowedReadOutcome<Stream>;
  readonly twitch?: FollowedReadOutcome<Stream>;
}): FollowingView {
  const live = [input.twitch, input.kick].flatMap((outcome) =>
    outcome === undefined ? [] : [...outcome.items],
  );
  const channels = channelRows(input.membership, live, input.notifications);
  return {
    accountImport: { kind: "disabled", reason: "guest-only-scope" },
    categories: categoryItems(input, live),
    channels: channelItems(input, channels),
    chip: input.chip,
    clips: recordedItems<Clip>(input, "clips"),
    live: liveItems(input, live),
    membership: input.membership,
    notifications: input.notifications,
    origin: { kind: "guest" },
    query: input.query,
    systemPush: { kind: "stubbed", reason: "system-push-not-shipped" },
    tab: input.tab,
    videos: recordedItems<Video>(input, "videos"),
  };
}

function liveItems(
  input: Parameters<typeof composeFollowingView>[0],
  streams: readonly Stream[],
): TabItems<Stream> {
  return collectionItems({
    emptyWhenUnfiltered: "none-live",
    failedPlatforms: failedPlatforms(input),
    items: filterStreams(streams, input.chip, input.query),
    loading: input.loadingLive,
    membership: input.membership,
    offline: isOffline(input),
    query: input.query,
    chip: input.chip,
    stale: isStale(input),
  });
}

function channelItems(
  input: Parameters<typeof composeFollowingView>[0],
  rows: readonly FollowingChannelRow[],
): TabItems<FollowingChannelRow> {
  const filtered = filterByChip(
    rows,
    input.chip,
    (row) => row.isLive,
  ).filter((row) =>
    matchesQuery(input.query, [
      row.follow.displayName,
      row.follow.channelLogin,
    ]),
  );
  return collectionItems({
    chip: input.chip,
    emptyWhenUnfiltered: "no-matches",
    failedPlatforms: failedPlatforms(input),
    items: sortChannels(filtered),
    loading: input.loadingLive,
    membership: input.membership,
    offline: isOffline(input),
    query: input.query,
    stale: isStale(input),
  });
}

function categoryItems(
  input: Parameters<typeof composeFollowingView>[0],
  streams: readonly Stream[],
): TabItems<Category> {
  return collectionItems({
    chip: input.chip,
    emptyWhenUnfiltered: "no-matches",
    failedPlatforms: failedPlatforms(input),
    items: filterByChip(
      categoriesFrom(streams),
      input.chip,
      () => true,
    ).filter((category) =>
      matchesQuery(input.query, [category.name, category.platform]),
    ),
    loading: input.loadingLive,
    membership: input.membership,
    offline: isOffline(input),
    query: input.query,
    stale: isStale(input),
  });
}

function recordedItems<
  T extends { readonly platform: Platform; readonly title: string },
>(
  input: Parameters<typeof composeFollowingView>[0],
  tab: "videos" | "clips",
): TabItems<T> {
  const recorded =
    input.tab === tab
      ? (input.recorded as FollowedRecordedOutcome<T> | undefined)
      : undefined;
  if (input.membership.length === 0) {
    return { kind: "empty", reason: "no-membership" };
  }
  if (input.tab === tab && input.loadingRecorded) return { kind: "loading" };
  if (recorded === undefined) {
    return { kind: "empty", reason: "no-matches" };
  }
  if (!recorded.supported) {
    return {
      items: [],
      kind: "unsupported",
      reason: `${recorded.platform}-recorded-unsupported`,
    };
  }
  if (recorded.failed) {
    return {
      items: [],
      kind: "failed",
      offline: recorded.offline,
      retryablePlatforms: [recorded.platform],
    };
  }
  return collectionItems({
    chip: input.chip,
    emptyWhenUnfiltered: "no-matches",
    failedPlatforms: [],
    items: recordedVisible(recorded.items, input.chip, input.query),
    loading: false,
    membership: input.membership,
    offline: recorded.offline,
    query: input.query,
    stale: recorded.stale,
  });
}

function collectionItems<T>(input: {
  readonly chip: FollowingChip;
  readonly emptyWhenUnfiltered: EmptyReason;
  readonly failedPlatforms: readonly Platform[];
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly membership: readonly GuestFollow[];
  readonly offline: boolean;
  readonly query: string;
  readonly stale: boolean;
}): TabItems<T> {
  if (input.membership.length === 0) {
    return { kind: "empty", reason: "no-membership" };
  }
  if (input.loading && input.items.length === 0) return { kind: "loading" };
  if (allMembershipFailed(input.membership, input.failedPlatforms)) {
    return {
      items: input.items,
      kind: "failed",
      offline: input.offline,
      retryablePlatforms: input.failedPlatforms,
    };
  }
  if (input.failedPlatforms.length > 0) {
    return {
      failedPlatforms: input.failedPlatforms,
      items: input.items,
      kind: "partial",
      stale: input.stale,
    };
  }
  if (input.items.length === 0) {
    return {
      kind: "empty",
      reason: emptyReason(input.chip, input.query, input.emptyWhenUnfiltered),
    };
  }
  return { items: input.items, kind: "ready", stale: input.stale };
}

function emptyReason(
  chip: FollowingChip,
  query: string,
  whenUnfiltered: EmptyReason,
): EmptyReason {
  return query.trim().length > 0 || chip !== "all"
    ? "no-matches"
    : whenUnfiltered;
}

function channelRows(
  membership: readonly GuestFollow[],
  streams: readonly Stream[],
  notifications: LiveNotificationPreferences,
): readonly FollowingChannelRow[] {
  return membership.map((follow) => {
    const stream = liveStreamFor(streams, follow);
    return {
      follow,
      isLive: stream !== null,
      notify: isPerChannelLiveNotificationEnabled(notifications, {
        id: follow.channelId,
        platform: follow.platform,
        username: follow.channelLogin,
      }),
      platform: follow.platform,
      stream,
    };
  });
}

function sortChannels(
  rows: readonly FollowingChannelRow[],
): readonly FollowingChannelRow[] {
  return rows.toSorted((left, right) => {
    if (left.isLive !== right.isLive) return left.isLive ? -1 : 1;
    return left.follow.displayName.localeCompare(right.follow.displayName);
  });
}

function categoriesFrom(streams: readonly Stream[]): readonly Category[] {
  const byKey = new Map<string, Category>();
  for (const stream of streams) {
    if (stream.categoryId === undefined || stream.categoryName === undefined) {
      continue;
    }
    const key = `${stream.platform}:${stream.categoryId}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      boxArtUrl: existing?.boxArtUrl ?? "",
      id: stream.categoryId,
      name: stream.categoryName,
      platform: stream.platform,
      viewerCount: (existing?.viewerCount ?? 0) + stream.viewerCount,
    });
  }
  return [...byKey.values()];
}

function failedPlatforms(
  input: Parameters<typeof composeFollowingView>[0],
): readonly Platform[] {
  return PLATFORMS.filter((platform) => {
    if (!input.membership.some((follow) => follow.platform === platform)) {
      return false;
    }
    const outcome = platform === "twitch" ? input.twitch : input.kick;
    return outcome?.retryable === true && outcome.status === "failed";
  });
}

function allMembershipFailed(
  membership: readonly GuestFollow[],
  failed: readonly Platform[],
): boolean {
  const relevant = PLATFORMS.filter((platform) =>
    membership.some((follow) => follow.platform === platform),
  );
  return relevant.length > 0 && relevant.every((platform) => failed.includes(platform));
}

function isStale(input: Parameters<typeof composeFollowingView>[0]): boolean {
  return input.twitch?.stale === true || input.kick?.stale === true;
}

function isOffline(input: Parameters<typeof composeFollowingView>[0]): boolean {
  return input.twitch?.offline === true || input.kick?.offline === true;
}
