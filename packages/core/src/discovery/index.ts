import {
  categorySchema,
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
  type Category,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "../content/index.ts";
import type { TopStreamReader } from "../capabilities/discovery.ts";
import type { Platform } from "../platform/index.ts";
import { normalizeSearchTokens } from "../use-cases/discovery-rules.ts";

export type {
  DiscoveryCancellationSignal,
  DiscoveryPageRequest,
  DiscoveryPageResult,
  DiscoveryPageSource,
  PageOptions,
  PageResult,
  TopStreamsOptions,
} from "../capabilities/discovery.ts";
export {
  compactSearchIdentity,
  isExactChannelSearchMatch,
  normalizeSearchQuery,
  normalizeSearchTokens,
  rankAndDeduplicateCategories,
  rankAndDeduplicateClips,
  rankAndDeduplicateStreams,
  rankAndDeduplicateVideos,
  rankCategoryMatch,
  rankChannelMatch,
  rankClipMatch,
  rankSearchChannels,
  rankStreamMatch,
  rankVideoMatch,
} from "../use-cases/discovery-rules.ts";
export type {
  CategorySearchCandidate,
  CategorySearchMatchRank,
  ChannelSearchCandidate,
  ChannelSearchRank,
  ClipSearchCandidate,
  DiscoveryIdentity,
  RecentContentSearchCandidate,
  SearchMatchRank,
  StreamSearchCandidate,
  VideoSearchCandidate,
} from "../use-cases/discovery-rules.ts";
export { createProgressiveDiscovery } from "../use-cases/progressive-discovery.ts";
export type {
  ProgressiveDiscoveryEndReason,
  ProgressiveDiscoveryProfile,
  ProgressiveDiscoveryRequest,
  ProgressiveDiscoveryResult,
} from "../use-cases/progressive-discovery.ts";

export type IPlatformReader<TStream = Stream> = TopStreamReader<
  Platform,
  TStream
>;

export const SEARCH_RESULT_TYPES = [
  "all",
  "channels",
  "streams",
  "categories",
  "videos",
  "clips",
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export interface SearchLimits {
  readonly resultLimit: number;
}

export interface SearchIntent {
  readonly query: string;
  readonly platform?: Platform;
  readonly resultType: SearchResultType;
  readonly liveOnly: boolean;
  readonly limits: SearchLimits;
}

export type SearchIntentIssue =
  | "empty-query"
  | "invalid-platform"
  | "invalid-result-type"
  | "invalid-result-limit"
  | "invalid-live-only";

export type SearchIntentValidation =
  | { readonly kind: "valid"; readonly intent: SearchIntent }
  | { readonly kind: "invalid"; readonly issues: readonly SearchIntentIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isSearchResultType(value: unknown): value is SearchResultType {
  return SEARCH_RESULT_TYPES.some((resultType) => resultType === value);
}

export function validateSearchIntent(value: unknown): SearchIntentValidation {
  const record = isRecord(value) ? value : {};
  const query =
    typeof record.query === "string"
      ? normalizeSearchTokens(record.query).join(" ")
      : "";
  const platform = isPlatform(record.platform) ? record.platform : undefined;
  const resultType = isSearchResultType(record.resultType)
    ? record.resultType
    : undefined;
  const liveOnly =
    typeof record.liveOnly === "boolean" ? record.liveOnly : undefined;
  const limits = isRecord(record.limits) ? record.limits : undefined;
  const resultLimit =
    limits &&
    typeof limits.resultLimit === "number" &&
    Number.isInteger(limits.resultLimit) &&
    limits.resultLimit > 0
      ? limits.resultLimit
      : undefined;
  const issues: SearchIntentIssue[] = [];
  if (!query) issues.push("empty-query");
  if (record.platform !== undefined && platform === undefined) {
    issues.push("invalid-platform");
  }
  if (resultType === undefined) issues.push("invalid-result-type");
  if (resultLimit === undefined) issues.push("invalid-result-limit");
  if (liveOnly === undefined) issues.push("invalid-live-only");
  if (
    issues.length > 0 ||
    resultType === undefined ||
    resultLimit === undefined ||
    liveOnly === undefined
  )
    return { kind: "invalid", issues };

  return {
    kind: "valid",
    intent: {
      query,
      ...(platform === undefined ? {} : { platform }),
      resultType,
      liveOnly,
      limits: { resultLimit },
    },
  };
}

export interface SearchResultCollection {
  readonly channels: readonly Channel[];
  readonly categories: readonly Category[];
  readonly streams: readonly Stream[];
  readonly videos: readonly Video[];
  readonly clips: readonly Clip[];
}

export interface SanitizedSearchResults {
  readonly data: SearchResultCollection;
  readonly rejectedCategories: number;
  readonly rejectedChannels: number;
  readonly rejectedStreams: number;
  readonly rejectedVideos: number;
  readonly rejectedClips: number;
}

export function sanitizeSearchResultCollection(
  value: unknown,
): SanitizedSearchResults {
  const record = isRecord(value) ? value : {};
  const rawChannels = Array.isArray(record.channels) ? record.channels : [];
  const rawCategories = Array.isArray(record.categories)
    ? record.categories
    : [];
  const rawStreams = Array.isArray(record.streams) ? record.streams : [];
  const rawVideos = Array.isArray(record.videos) ? record.videos : [];
  const rawClips = Array.isArray(record.clips) ? record.clips : [];
  const channels = rawChannels.filter(channelSchema.is);
  const categories = rawCategories.filter(categorySchema.is);
  const streams = rawStreams.filter(streamSchema.is);
  const videos = rawVideos.filter(videoSchema.is);
  const clips = rawClips.filter(clipSchema.is);
  return {
    data: { channels, categories, streams, videos, clips },
    rejectedCategories: rawCategories.length - categories.length,
    rejectedChannels: rawChannels.length - channels.length,
    rejectedStreams: rawStreams.length - streams.length,
    rejectedVideos: rawVideos.length - videos.length,
    rejectedClips: rawClips.length - clips.length,
  };
}

export type DiscoveryProviderStatus =
  "complete" | "partial" | "stale" | "failed";

export type DiscoveryProviderCompletion = Partial<
  Record<Platform, DiscoveryProviderStatus>
>;

export type DiscoveryResult<T> =
  | {
      readonly success: true;
      readonly data: T;
      readonly cursor?: string;
      readonly platform?: Platform;
      readonly providers: DiscoveryProviderCompletion;
    }
  | {
      readonly success: false;
      readonly error: string;
      readonly platform?: Platform;
      readonly providers: DiscoveryProviderCompletion;
    };

export interface DiscoveryProviderOutcome<TItem> {
  readonly platform: Platform;
  readonly status: DiscoveryProviderStatus;
  readonly data: readonly TItem[];
  readonly cursor?: string;
  readonly error?: string;
}

export function hasCompleteDiscoveryCoverage(
  providers: DiscoveryProviderCompletion,
  platform?: Platform,
): boolean {
  return platform
    ? providers[platform] === "complete"
    : providers.twitch === "complete" && providers.kick === "complete";
}

export function settleDiscoveryProviders<TItem>(options: {
  readonly requestedPlatforms: readonly Platform[];
  readonly outcomes: readonly DiscoveryProviderOutcome<TItem>[];
  readonly limit?: number;
  readonly compare?: (left: TItem, right: TItem) => number;
}): DiscoveryResult<TItem[]> {
  const byPlatform = new Map(
    options.outcomes.map((outcome) => [outcome.platform, outcome]),
  );
  const providers = Object.fromEntries(
    options.requestedPlatforms.map((platform) => [
      platform,
      byPlatform.get(platform)?.status ?? "failed",
    ]),
  );
  const usable = options.requestedPlatforms
    .map((platform) => byPlatform.get(platform))
    .filter(
      (outcome): outcome is DiscoveryProviderOutcome<TItem> =>
        outcome !== undefined && outcome.status !== "failed",
    );

  if (usable.length === 0) {
    const errors = options.requestedPlatforms
      .map(
        (platform) =>
          byPlatform.get(platform)?.error ?? `${platform} unavailable`,
      )
      .filter((error, index, all) => all.indexOf(error) === index);
    return {
      success: false,
      error: errors.join("; "),
      providers,
      ...(options.requestedPlatforms.length === 1
        ? { platform: options.requestedPlatforms[0] }
        : {}),
    };
  }

  const data = usable.flatMap((outcome) => outcome.data);
  if (options.requestedPlatforms.length > 1 && options.compare) {
    data.sort(options.compare);
  }
  const first = options.requestedPlatforms.length === 1 ? usable[0] : undefined;
  return {
    success: true,
    data: options.limit === undefined ? data : data.slice(0, options.limit),
    providers,
    ...(first ? { platform: first.platform } : {}),
    ...(first?.cursor ? { cursor: first.cursor } : {}),
  };
}
