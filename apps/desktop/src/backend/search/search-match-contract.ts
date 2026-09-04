import {
  rankAndDeduplicateClips,
  rankAndDeduplicateStreams,
  rankAndDeduplicateVideos,
  rankSearchChannels,
} from "@streamfusion/core/discovery";
import type {
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../shared/platform-types";
import {
  normalizeUnifiedChannel,
  normalizeUnifiedClip,
  normalizeUnifiedStream,
  normalizeUnifiedVideo,
} from "../../frontend/features/discovery/utils/search/search-result-validation";

export {
  filterRankAndDeduplicateCategories,
  mergeExactCrossPlatformCategories,
} from "../../frontend/features/discovery/utils/search/category-search-contract";
export {
  isValidUnifiedCategory,
  isValidUnifiedChannel,
  isValidUnifiedClip,
  isValidUnifiedStream,
  normalizeUnifiedCategory,
  normalizeUnifiedChannel,
  normalizeUnifiedClip,
  normalizeUnifiedStream,
  normalizeUnifiedVideo,
} from "../../frontend/features/discovery/utils/search/search-result-validation";

function normalizeValues<TItem>(
  values: readonly unknown[],
  normalize: (value: unknown) => TItem | null
): TItem[] {
  return values.flatMap((value) => {
    const item = normalize(value);
    return item ? [item] : [];
  });
}

export function filterRankAndDeduplicateChannels(
  channels: readonly unknown[],
  query: string
): UnifiedChannel[] {
  return rankSearchChannels(normalizeValues(channels, normalizeUnifiedChannel), query);
}

export function filterRankAndDeduplicateStreams(
  streams: readonly unknown[],
  query: string
): UnifiedStream[] {
  return rankAndDeduplicateStreams(normalizeValues(streams, normalizeUnifiedStream), query);
}

export function filterRankAndDeduplicateVideos(
  videos: readonly unknown[],
  query: string
): UnifiedVideo[] {
  return rankAndDeduplicateVideos(normalizeValues(videos, normalizeUnifiedVideo), query);
}

export function filterRankAndDeduplicateClips(
  clips: readonly unknown[],
  query: string
): UnifiedClip[] {
  return rankAndDeduplicateClips(normalizeValues(clips, normalizeUnifiedClip), query);
}
