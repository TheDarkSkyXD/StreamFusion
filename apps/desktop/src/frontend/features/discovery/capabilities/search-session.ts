import type { DiscoveryResult } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import type { PaginatedIpcResult } from "@shared/ipc-channels";
import type {
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "@shared/platform-types";
import type {
  SearchClipsRequest,
  SearchPlatformError,
  SearchResultCollection,
  SearchStreamsRequest,
  SearchVideosRequest,
} from "@shared/search-types";

export type ProgressiveSearchKind = "streams" | "videos" | "clips";
export type ProgressiveSearchItem = UnifiedStream | UnifiedVideo | UnifiedClip;

export interface ProgressiveSearchRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  cursor?: string;
  liveOnly?: boolean;
}

export interface ProgressiveSearchResponse<T extends ProgressiveSearchItem> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: T[];
  cursor?: string;
  endReason?: string;
  retryAfterMs?: number;
  retryable: boolean;
  error: SearchPlatformError | null;
}

export interface DiscoverySearchSession {
  streams(request: SearchStreamsRequest): Promise<ProgressiveSearchResponse<UnifiedStream>>;
  videos(request: SearchVideosRequest): Promise<ProgressiveSearchResponse<UnifiedVideo>>;
  clips(request: SearchClipsRequest): Promise<ProgressiveSearchResponse<UnifiedClip>>;
  channels(request: {
    query: string;
    platform?: Platform;
    liveOnly?: boolean;
    limit?: number;
    after?: string;
  }): Promise<PaginatedIpcResult<UnifiedChannel[]>>;
  all(request: {
    query: string;
    platform?: Platform;
    limit?: number;
    channelSeeds?: UnifiedChannel[];
    channelSeedPlatforms?: Platform[];
    requestId?: string;
  }): Promise<DiscoveryResult<SearchResultCollection>>;
  cancel(request: { requestId: string }): Promise<{ success: boolean; cancelled: boolean }>;
}
