import type { Platform } from "./auth-types";

export interface ChatReplaySender {
  id: string;
  login: string;
  displayName: string;
  color?: string;
}

export interface ChatReplayBadge {
  id: string;
  setId: string;
  version: string;
  imageUrl?: string;
  title?: string;
}

export type ChatReplayFragment =
  | { type: "text"; text: string }
  | { type: "emote"; text: string; emoteId: string; url?: string };

export interface ChatReplayMessage {
  id: string;
  offsetSeconds: number;
  sender: ChatReplaySender;
  badges: ChatReplayBadge[];
  fragments: ChatReplayFragment[];
}

export interface ChatReplayWindowRequest {
  platform: Platform;
  videoId: string;
  offsetSeconds: number;
  locator?: {
    channelId?: string;
    startedAt?: string;
    videoUuid?: string;
  };
}

export interface ChatReplayIpcWindowRequest extends ChatReplayWindowRequest {
  requestId: string;
}

export interface CancelChatReplayWindowRequest {
  requestId: string;
}

export interface CancelChatReplayWindowResult {
  cancelled: boolean;
}

export interface VideoPlaybackSnapshot {
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
}

export type ChatReplayWindowResult =
  | {
      capability: "supported";
      platform: Platform;
      videoId: string;
      messages: ChatReplayMessage[];
      nextCursor: string | null;
      hasNextPage: boolean;
    }
  | { capability: "empty"; platform: Platform; videoId: string }
  | { capability: "unsupported"; platform: Platform; videoId: string }
  | { capability: "transient-failure"; platform: Platform; videoId: string; reason: string };

export type ChatReplayIpcWindowResult =
  | { success: true; data: ChatReplayWindowResult }
  | { success: false; error: string };
