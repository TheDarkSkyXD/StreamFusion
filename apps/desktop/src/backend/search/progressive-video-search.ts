import type { UnifiedChannel, UnifiedVideo } from "@shared/platform-types";
import {
  createProgressiveRecentContentSearch,
  type RecentContentSearchPage,
  type RecentContentSearchProfile,
  type RecentContentSearchProviderPage,
  type RecentContentSearchRequest,
  type RecentContentSearchSource,
} from "@backend/search/progressive-recent-content-search";
import { filterRankAndDeduplicateVideos } from "@backend/search/search-match-contract";

export type VideoSearchEndReason = "exhausted" | "safety-limit" | "rate-limited";

export interface VideoSearchProfile {
  pageSize: number;
  maxConcurrentRequests: number;
}

export interface VideoSearchSource {
  searchChannels: RecentContentSearchSource["searchChannels"];
  fetchVideos(
    channel: UnifiedChannel,
    options: {
      cursor?: string;
      limit: number;
      signal: AbortSignal;
      consumeRequest: () => void;
    }
  ): Promise<RecentContentSearchProviderPage<unknown>>;
}

export type VideoSearchRequest = RecentContentSearchRequest;
export type VideoSearchPage = RecentContentSearchPage<UnifiedVideo>;

export function createProgressiveVideoSearch(options: {
  source: VideoSearchSource;
  profile: VideoSearchProfile;
}) {
  const profile: RecentContentSearchProfile = options.profile;
  return createProgressiveRecentContentSearch<UnifiedVideo>({
    source: {
      searchChannels: options.source.searchChannels,
      fetchContent: options.source.fetchVideos,
    },
    profile,
    filterRankAndDeduplicate: filterRankAndDeduplicateVideos,
    label: "Video",
  });
}
