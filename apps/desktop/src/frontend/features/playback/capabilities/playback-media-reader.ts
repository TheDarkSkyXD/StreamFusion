import type { UnifiedStream } from "@shared/platform-types";
import type { Platform } from "@streamfusion/core/platform";
import type { IpcResult, PaginatedIpcResult } from "@shared/ipc-channels";

export interface PlaybackMediaReader {
  videos: {
    getPlaybackUrl: (params: {
      platform: Platform;
      videoId: string;
    }) => Promise<IpcResult<{ url: string }>>;
    getMetadata: (params: { platform: Platform; videoId: string }) => Promise<{
      success: boolean;
      data?: {
        id: string;
        title: string;
        channelId: string;
        channelName: string;
        channelDisplayName: string;
        channelAvatar: string | null;
        views: number;
        duration: string;
        createdAt: string;
        thumbnailUrl: string;
        description: string;
        type: string;
        platform: string;
        shareUrl?: string;
      };
      error?: string;
    }>;
    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
      sort?: "date" | "views";
    }) => Promise<PaginatedIpcResult<unknown[]>>;
    getByLivestreamId: (params: { channelSlug: string; livestreamId: string }) => Promise<{
      success: boolean;
      data?: {
        id: string;
        title: string;
        source: string;
        thumbnailUrl: string;
        duration: string;
        views: string;
        date: string;
        channelSlug: string;
        channelName: string;
        category: string;
        shareUrl?: string;
      };
      error?: string;
    }>;
  };
  clips: {
    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
      sort?: "date" | "views";
      timeRange?: "day" | "week" | "month" | "all";
    }) => Promise<PaginatedIpcResult<unknown[]>>;
    getPlaybackUrl: (params: {
      platform: Platform;
      clipId: string;
      thumbnailUrl?: string;
      clipUrl?: string;
    }) => Promise<IpcResult<{ url: string; format: string }>>;
  };
  streams: {
    getByChannel: (params: {
      platform: Platform;
      username: string;
    }) => Promise<IpcResult<UnifiedStream | null>>;
  };
}
