import type { DiscoveryResult } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import type { FollowedStreamsRequest, IpcResult } from "@shared/ipc-channels";
import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "@shared/platform-types";

export interface TopStreamsRequest {
  platform?: Platform;
  categoryId?: string;
  language?: string;
  limit?: number;
  cursor?: string;
}

export interface CategoryStreamsRequest {
  categoryId: string;
  platform?: Platform;
  limit?: number;
  cursor?: string;
  categoryName?: string;
  language?: string;
}

export interface CategorySearchRequest {
  query: string;
  platform?: Platform;
  limit?: number;
  after?: string;
}

export interface DiscoveryReader {
  readonly categories: {
    getTop(request?: { platform?: Platform; limit?: number; cursor?: string }): Promise<
      DiscoveryResult<UnifiedCategory[]>
    >;
    getMetadata(request: {
      platform: Platform;
      categoryId: string;
      slug?: string;
    }): Promise<{
      success: boolean;
      data?: { tags?: string[]; streamCount: number; streamCountExact: boolean };
      error?: string;
    }>;
    search(request: CategorySearchRequest): Promise<DiscoveryResult<UnifiedCategory[]>>;
    getById(request: {
      platform: Platform;
      categoryId: string;
    }): Promise<IpcResult<UnifiedCategory | null>>;
  };
  readonly streams: {
    getTop(request?: TopStreamsRequest): Promise<DiscoveryResult<UnifiedStream[]>>;
    getFollowed(request?: FollowedStreamsRequest): Promise<DiscoveryResult<UnifiedStream[]>>;
    getByChannel(request: {
      platform: Platform;
      username: string;
    }): Promise<IpcResult<UnifiedStream | null>>;
    getByCategory(request: CategoryStreamsRequest): Promise<DiscoveryResult<UnifiedStream[]>>;
  };
  readonly channels: {
    getFollowed(request: { platform: Platform }): Promise<IpcResult<UnifiedChannel[]>>;
    getByUsername(request: {
      platform: Platform;
      username: string;
      freshChatroomSettings?: boolean;
    }): Promise<IpcResult<UnifiedChannel | null>>;
  };
}
