import type { Platform } from "./auth-types";

export type CategoryMediaSort = "date" | "views";
export type CategoryMediaDirection = "asc" | "desc";
export type CategoryClipTimeRange = "day" | "week" | "month" | "all";
export type CategoryMediaAvailability = "available" | "unsupported" | "unavailable";

export interface CategoryMediaRequest {
  platform: Platform;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  limit?: number;
  cursor?: string;
  sort?: CategoryMediaSort;
  direction?: CategoryMediaDirection;
  language?: string;
  tag?: string;
}

export interface CategoryClipsRequest extends CategoryMediaRequest {
  timeRange?: CategoryClipTimeRange;
}

export type CategoryVideosRequest = CategoryMediaRequest;

export interface CategoryMediaItem {
  id: string;
  title: string;
  duration: string;
  views: string;
  date: string;
  created_at: string;
  thumbnailUrl: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  channelAvatar: string;
  gameId: string;
  gameName: string;
  category: string;
  creatorName?: string;
  embedUrl?: string;
  url?: string;
  shareUrl?: string;
  source?: string;
  isLive?: boolean;
  isSubOnly?: boolean;
  language?: string;
  vodId?: string;
}

export interface CategoryMediaResult {
  success: boolean;
  availability: CategoryMediaAvailability;
  data?: CategoryMediaItem[];
  cursor?: string;
  errorCode?: "unsupported" | "invalid-request" | "upstream-error";
  error?: string;
}
