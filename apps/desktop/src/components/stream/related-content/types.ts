import type { Platform } from "@/shared/auth-types";

export interface VideoOrClip {
  id: string;
  title: string;
  duration: string;
  views: string;
  viewCount?: string | number;
  view_count?: string | number;
  date: string;
  created_at?: string; // ISO timestamp for more accurate time-ago calculation
  creatorName?: string;
  thumbnailUrl: string;
  embedUrl?: string; // For clips
  url?: string; // For clips
  source?: string; // HLS m3u8 URL for VODs (especially Kick)
  gameName?: string;
  isLive?: boolean;
  isSubOnly?: boolean; // Whether the VOD is subscriber-only content
  // Additional metadata for passing to video page
  channelSlug?: string;
  channelName?: string;
  channelAvatar?: string | null;
  channelFollowerCount?: number;
  category?: string;
  // Stream tags
  tags?: string[];
  language?: string;
  isMature?: boolean;
  // VOD availability for clips - empty/null means VOD is no longer available
  vodId?: string;
  platform?: Platform;
}

export interface ClipPlayerProps {
  src: string;
  autoPlay?: boolean;
  onError?: () => void;
}

export interface RelatedContentProps {
  platform: Platform;
  channelName: string;
  channelData: import("@/backend/api/unified/platform-types").UnifiedChannel | null | undefined;
  /** Truthy while the stream is live; flips to undefined/null when it ends. */
  streamStartedAt?: string | null;
  onClipSelectionChange?: (isOpen: boolean) => void;
}
