import type { Platform } from "@streamfusion/core/platform";
import type {
  CategoryClipsRequest,
  CategoryMediaResult,
  CategoryVideosRequest,
} from "@shared/category-media-types";
import type { IpcResult, PaginatedIpcResult } from "@shared/ipc-channels";

export interface ChannelMediaRequest {
  platform: Platform;
  channelName: string;
  channelId?: string;
  limit?: number;
  cursor?: string;
  sort?: "date" | "views";
}

export interface DiscoveryMediaReader {
  videos: {
    getByChannel(request: ChannelMediaRequest): Promise<PaginatedIpcResult<unknown[]>>;
    getByCategory(request: CategoryVideosRequest): Promise<CategoryMediaResult>;
  };
  clips: {
    getByChannel(
      request: ChannelMediaRequest & { timeRange?: "day" | "week" | "month" | "all" }
    ): Promise<PaginatedIpcResult<unknown[]>>;
    getByCategory(request: CategoryClipsRequest): Promise<CategoryMediaResult>;
    getPlaybackUrl(request: {
      platform: Platform;
      clipId: string;
      thumbnailUrl?: string;
      clipUrl?: string;
    }): Promise<IpcResult<{ url: string; format: string }>>;
  };
}
