import type { Platform } from "@streamfusion/core/platform";

import type { IpcResult, PaginatedIpcResult } from "@shared/ipc-channels";

/** Narrow read port for validating and resolving library history playback. */
export interface MediaPlaybackReader {
  getChannelClips(request: {
    platform: Platform;
    channelName: string;
    limit?: number;
    sort?: "date" | "views";
    timeRange?: "day" | "week" | "month" | "all";
  }): Promise<PaginatedIpcResult<unknown[]>>;
  getVideoPlaybackUrl(request: {
    platform: Platform;
    videoId: string;
  }): Promise<IpcResult<{ url: string }>>;
  getClipPlaybackUrl(request: {
    platform: Platform;
    clipId: string;
    thumbnailUrl?: string;
    clipUrl?: string;
  }): Promise<IpcResult<{ url: string; format: string }>>;
}
