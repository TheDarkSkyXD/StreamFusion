import type { UnifiedChannel, UnifiedClip } from "@shared/platform-types";
import {
  createProgressiveRecentContentSearch,
  type RecentContentSearchPage,
  type RecentContentSearchProfile,
  type RecentContentSearchProviderPage,
  type RecentContentSearchRequest,
  type RecentContentSearchSource,
} from "@backend/features/discovery/domain/progressive-recent-content-search";
import { filterRankAndDeduplicateClips } from "@backend/features/discovery/domain/search-match-contract";

export interface ClipSearchProfile {
  pageSize: number;
  maxConcurrentRequests: number;
}

export interface ClipSearchSource {
  searchChannels: RecentContentSearchSource["searchChannels"];
  fetchClips(
    channel: UnifiedChannel,
    options: {
      cursor?: string;
      limit: number;
      signal: AbortSignal;
      consumeRequest: () => void;
    }
  ): Promise<RecentContentSearchProviderPage<unknown>>;
}

export type ClipSearchRequest = RecentContentSearchRequest;
export type ClipSearchPage = RecentContentSearchPage<UnifiedClip>;

export function createProgressiveClipSearch(options: {
  source: ClipSearchSource;
  profile: ClipSearchProfile;
}) {
  const profile: RecentContentSearchProfile = options.profile;
  return createProgressiveRecentContentSearch<UnifiedClip>({
    source: {
      searchChannels: options.source.searchChannels,
      fetchContent: options.source.fetchClips,
    },
    profile,
    filterRankAndDeduplicate: filterRankAndDeduplicateClips,
    label: "Clip",
  });
}
