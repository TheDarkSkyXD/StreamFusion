import type { Clip, Stream, Video } from "@streamfusion/core/content";
import { PLATFORMS, type Platform } from "@streamfusion/core/platform";

import type {
  HomeLiveDiscoveryPhase,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import { sortCopy } from "../utils/sort-copy";
import type {
  CategoryFollowState,
  CategoryIdentity,
  CategoryRequestIdentity,
} from "./category-identity";
import {
  GUEST_CATEGORY_FOLLOW,
  platformsForScope,
} from "./category-identity";

export type CategoryMediaPage =
  | { readonly kind: "live"; readonly items: readonly Stream[] }
  | { readonly kind: "clips"; readonly items: readonly Clip[] }
  | { readonly kind: "videos"; readonly items: readonly Video[] }
  | {
      readonly kind: "unavailable";
      readonly reason: "kick-clips-unsupported" | "kick-videos-unsupported";
    };

export type CategoryMediaItem = Stream | Clip | Video;

export type CategoryDetailView = {
  readonly phase: HomeLiveDiscoveryPhase;
  readonly identity: CategoryRequestIdentity;
  readonly header: CategoryIdentity;
  readonly viewerSummary: number;
  readonly follow: CategoryFollowState;
  readonly media: CategoryMediaPage;
  readonly providers: Readonly<
    Record<Platform, PlatformReadOutcome<CategoryMediaItem>>
  >;
  readonly retryablePlatforms: readonly Platform[];
};

const emptyOutcome = (
  platform: Platform,
): PlatformReadOutcome<CategoryMediaItem> => ({
  cache: { kind: "miss" },
  items: [],
  path: { kind: "unavailable", platform, reason: "cancelled" },
  platform,
  status: "failed",
});

export function composeCategoryDetail(input: {
  readonly follow?: CategoryFollowState;
  readonly identity: CategoryRequestIdentity;
  readonly kick?: PlatformReadOutcome<CategoryMediaItem>;
  readonly kickUnavailable?: CategoryMediaPage;
  readonly loading: boolean;
  readonly twitch?: PlatformReadOutcome<CategoryMediaItem>;
  readonly twitchUnavailable?: CategoryMediaPage;
}): CategoryDetailView {
  const twitch = input.twitch ?? emptyOutcome("twitch");
  const kick = input.kick ?? emptyOutcome("kick");
  const media = selectMedia(input);
  return {
    follow: input.follow ?? GUEST_CATEGORY_FOLLOW,
    header: input.identity.category,
    identity: input.identity,
    media,
    phase: detailPhase({
      kick,
      loading: input.loading,
      media,
      twitch,
    }),
    providers: { kick, twitch },
    retryablePlatforms: retryablePlatforms({ kick, twitch }),
    viewerSummary: viewerSummary(media),
  };
}

function selectMedia(input: {
  readonly identity: CategoryRequestIdentity;
  readonly kick?: PlatformReadOutcome<CategoryMediaItem>;
  readonly kickUnavailable?: CategoryMediaPage;
  readonly twitch?: PlatformReadOutcome<CategoryMediaItem>;
  readonly twitchUnavailable?: CategoryMediaPage;
}): CategoryMediaPage {
  const twitchInScope = platformsForScope(
    input.identity.platformScope,
    input.identity.category,
  ).includes("twitch");
  if (input.identity.tab === "clips") {
    if (input.twitchUnavailable?.kind === "unavailable")
      return input.twitchUnavailable;
    if (!twitchInScope) {
      return input.kickUnavailable ?? {
        kind: "unavailable",
        reason: "kick-clips-unsupported",
      };
    }
    return {
      kind: "clips",
      items: sortClips(clipsOf(input.twitch)),
    };
  }
  if (input.identity.tab === "videos") {
    if (!twitchInScope) {
      return input.kickUnavailable ?? {
        kind: "unavailable",
        reason: "kick-videos-unsupported",
      };
    }
    return {
      kind: "videos",
      items: sortVideos(videosOf(input.twitch), input.identity.videoSort),
    };
  }
  return {
    kind: "live",
    items: sortLive(
      filterLive(
        [...streamsOf(input.twitch), ...streamsOf(input.kick)],
        input.identity,
      ),
      input.identity.liveSort,
    ),
  };
}

function streamsOf(
  outcome: PlatformReadOutcome<CategoryMediaItem> | undefined,
): Stream[] {
  return (outcome?.items ?? []).flatMap((item) =>
    isStream(item) ? [item] : [],
  );
}

function clipsOf(
  outcome: PlatformReadOutcome<CategoryMediaItem> | undefined,
): Clip[] {
  return (outcome?.items ?? []).flatMap((item) => (isClip(item) ? [item] : []));
}

function videosOf(
  outcome: PlatformReadOutcome<CategoryMediaItem> | undefined,
): Video[] {
  return (outcome?.items ?? []).flatMap((item) =>
    isRecordedVideo(item) ? [item] : [],
  );
}

function filterLive(
  items: readonly Stream[],
  identity: CategoryRequestIdentity,
): Stream[] {
  return items.filter((item) => {
    if (
      identity.language !== "all" &&
      item.language !== identity.language
    ) {
      return false;
    }
    if (identity.tag !== "all" && !item.tags.includes(identity.tag)) {
      return false;
    }
    return true;
  });
}

function sortLive(items: readonly Stream[], sort: "viewers-desc" | "viewers-asc"): Stream[] {
  return sortCopy(items, (left, right) =>
    sort === "viewers-asc"
      ? left.viewerCount - right.viewerCount
      : right.viewerCount - left.viewerCount,
  );
}

function sortClips(items: readonly Clip[]): Clip[] {
  return sortCopy(items, (left, right) => right.viewCount - left.viewCount);
}

function sortVideos(
  items: readonly Video[],
  sort: CategoryRequestIdentity["videoSort"],
): Video[] {
  return sortCopy(items, (left, right) =>
    sort === "views"
      ? right.viewCount - left.viewCount
      : right.publishedAt.localeCompare(left.publishedAt),
  );
}

function viewerSummary(media: CategoryMediaPage): number {
  if (media.kind !== "live") return 0;
  return media.items.reduce((sum, stream) => sum + stream.viewerCount, 0);
}

function detailPhase(input: {
  readonly kick: PlatformReadOutcome<CategoryMediaItem>;
  readonly loading: boolean;
  readonly media: CategoryMediaPage;
  readonly twitch: PlatformReadOutcome<CategoryMediaItem>;
}): HomeLiveDiscoveryPhase {
  if (input.media.kind === "unavailable") return "ready";
  if (input.loading && input.media.items.length === 0) return "loading";
  const usable = [input.twitch, input.kick].filter(
    (outcome) => outcome.status !== "failed",
  );
  if (usable.length === 0) {
    return [input.twitch, input.kick].some(
      (outcome) => outcome.cache.kind === "hit",
    )
      ? "offline-cache"
      : "failed";
  }
  if (input.media.items.length === 0) return "empty";
  return "ready";
}

function retryablePlatforms(providers: {
  readonly kick: PlatformReadOutcome<CategoryMediaItem>;
  readonly twitch: PlatformReadOutcome<CategoryMediaItem>;
}): readonly Platform[] {
  return PLATFORMS.filter((platform) => {
    const outcome = providers[platform];
    return outcome.error?.retry !== "none" && outcome.status !== "complete";
  });
}

function isStream(item: CategoryMediaItem): item is Stream {
  return "isLive" in item && "viewerCount" in item && "channelName" in item;
}

function isClip(item: CategoryMediaItem): item is Clip {
  return "clipUrl" in item && "creatorName" in item;
}

function isRecordedVideo(item: CategoryMediaItem): item is Video {
  return (
    "url" in item &&
    "publishedAt" in item &&
    "type" in item &&
    (item.type === "archive" ||
      item.type === "highlight" ||
      item.type === "upload")
  );
}
