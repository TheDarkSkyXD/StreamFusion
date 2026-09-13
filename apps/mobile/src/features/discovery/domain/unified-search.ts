import type { SearchIntent } from "@streamfusion/core/discovery";
import { PLATFORMS, type Platform } from "@streamfusion/core/platform";

import type {
  SearchCatalogPage,
  SearchHistoryByScope,
  SearchReadOutcome,
  UnifiedSearchPhase,
  UnifiedSearchView,
} from "../capabilities/platform-reads";

import {
  dedupeByIdentity,
  emptySearchCatalog,
} from "./search-catalog";

const ALL_CHANNEL_LIMIT = 12;
const ALL_STREAM_LIMIT = 12;
const ALL_CATEGORY_LIMIT = 12;
const ALL_MEDIA_LIMIT = 6;

const emptyOutcome = (platform: Platform): SearchReadOutcome => ({
  cache: { kind: "miss" },
  catalog: emptySearchCatalog(),
  path: { kind: "unavailable", platform, reason: "cancelled" },
  platform,
  status: "failed",
});

export function composeUnifiedSearch(input: {
  readonly history: SearchHistoryByScope;
  readonly historyConfirmClear?: boolean;
  readonly intent: SearchIntent | null;
  readonly kick?: SearchReadOutcome;
  readonly loading: boolean;
  readonly twitch?: SearchReadOutcome;
}): UnifiedSearchView {
  const twitch = input.twitch;
  const kick = input.kick;
  const providers = {
    kick: kick ?? emptyOutcome("kick"),
    twitch: twitch ?? emptyOutcome("twitch"),
  };
  const merged = mergeCatalogs(
    twitch?.catalog ?? emptySearchCatalog(),
    kick?.catalog ?? emptySearchCatalog(),
  );
  const collection = projectCollection(merged, input.intent);
  return {
    bestMatch: collection.channels[0] ?? null,
    collection,
    history: input.history,
    historyConfirmClear: input.historyConfirmClear === true,
    intent: input.intent,
    phase: searchPhase({
      arrived: [twitch, kick].filter(
        (outcome): outcome is SearchReadOutcome => outcome !== undefined,
      ),
      collection,
      intent: input.intent,
      loading: input.loading,
    }),
    providers,
    retryablePlatforms: retryablePlatforms(providers, input.intent),
  };
}

function mergeCatalogs(
  twitch: SearchCatalogPage,
  kick: SearchCatalogPage,
): SearchCatalogPage {
  return {
    categories: dedupeByIdentity([...twitch.categories, ...kick.categories]),
    channels: dedupeByIdentity([...twitch.channels, ...kick.channels]),
    clips: dedupeByIdentity([...twitch.clips, ...kick.clips]),
    streams: dedupeByIdentity(
      liveFirst([...twitch.streams, ...kick.streams]),
    ),
    videos: dedupeByIdentity([...twitch.videos, ...kick.videos]),
  };
}

function projectCollection(
  catalog: SearchCatalogPage,
  intent: SearchIntent | null,
): SearchCatalogPage {
  if (intent === null) return emptySearchCatalog();
  const liveChannels = intent.liveOnly
    ? catalog.channels.filter((channel) => channel.isLive)
    : catalog.channels;
  const liveStreams = catalog.streams.filter((stream) => stream.isLive);
  const hideMedia = intent.liveOnly;
  const limits = tabLimits(intent);
  const projected: SearchCatalogPage = {
    categories: take(catalog.categories, limits.categories),
    channels: take(liveChannels, limits.channels),
    clips: hideMedia ? [] : take(catalog.clips, limits.clips),
    streams: take(liveStreams, limits.streams),
    videos: hideMedia ? [] : take(catalog.videos, limits.videos),
  };
  if (intent.resultType === "all") return projected;
  return {
    categories: intent.resultType === "categories" ? projected.categories : [],
    channels: intent.resultType === "channels" ? projected.channels : [],
    clips: intent.resultType === "clips" ? projected.clips : [],
    streams: intent.resultType === "streams" ? projected.streams : [],
    videos: intent.resultType === "videos" ? projected.videos : [],
  };
}

function tabLimits(intent: SearchIntent): {
  readonly categories: number;
  readonly channels: number;
  readonly clips: number;
  readonly streams: number;
  readonly videos: number;
} {
  const typed = intent.limits.resultLimit;
  if (intent.resultType === "all") {
    return {
      categories: ALL_CATEGORY_LIMIT,
      channels: ALL_CHANNEL_LIMIT,
      clips: ALL_MEDIA_LIMIT,
      streams: ALL_STREAM_LIMIT,
      videos: ALL_MEDIA_LIMIT,
    };
  }
  return {
    categories: typed,
    channels: typed,
    clips: typed,
    streams: typed,
    videos: typed,
  };
}

function searchPhase(input: {
  readonly arrived: readonly SearchReadOutcome[];
  readonly collection: SearchCatalogPage;
  readonly intent: SearchIntent | null;
  readonly loading: boolean;
}): UnifiedSearchPhase {
  if (input.intent === null) return "idle";
  if (input.loading && catalogSize(input.collection) === 0) return "loading";
  if (input.arrived.length === 0) return input.loading ? "loading" : "idle";
  const usable = input.arrived.filter((outcome) => outcome.status !== "failed");
  if (usable.length === 0) {
    return input.arrived.some((outcome) => outcome.cache.kind === "hit")
      ? "offline-cache"
      : "failed";
  }
  if (catalogSize(input.collection) === 0) {
    return input.loading ? "loading" : "empty";
  }
  if (
    input.arrived.some(
      (outcome) =>
        outcome.status === "stale" ||
        (outcome.cache.kind === "hit" && outcome.cache.stale),
    )
  ) {
    return "offline-cache";
  }
  if (
    !input.loading &&
    input.arrived.some(
      (outcome) => outcome.status === "partial" || outcome.status === "failed",
    )
  ) {
    return "partial";
  }
  return "ready";
}

function retryablePlatforms(
  providers: {
    readonly kick: SearchReadOutcome;
    readonly twitch: SearchReadOutcome;
  },
  intent: SearchIntent | null,
): readonly Platform[] {
  const requested =
    intent?.platform === undefined ? PLATFORMS : [intent.platform];
  return requested.filter((platform) => {
    const outcome = providers[platform];
    if (outcome.error?.retry === "none") return false;
    return (
      outcome.error?.retry === "manual" ||
      outcome.error?.retry === "after" ||
      outcome.status === "failed" ||
      outcome.status === "partial"
    );
  });
}

function catalogSize(catalog: SearchCatalogPage): number {
  return (
    catalog.channels.length +
    catalog.streams.length +
    catalog.categories.length +
    catalog.videos.length +
    catalog.clips.length
  );
}

function liveFirst<TItem extends { readonly isLive?: boolean }>(
  items: readonly TItem[],
): readonly TItem[] {
  return [...items].sort((left, right) =>
    Number(right.isLive === true) - Number(left.isLive === true),
  );
}

function take<TItem>(items: readonly TItem[], limit: number): readonly TItem[] {
  return items.slice(0, limit);
}
