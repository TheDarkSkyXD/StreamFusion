import type { Platform } from "./auth-types";

export type SearchResultType = "all" | "channels" | "streams" | "categories" | "videos" | "clips";

export interface SearchLimits {
  resultLimit: number;
}

export interface SearchIntent {
  query: string;
  platform?: Platform;
  resultType: SearchResultType;
  liveOnly: boolean;
  limits: SearchLimits;
}

export interface SearchAllRequest extends SearchIntent {
  sessionId: string;
  platform: Platform;
}

export type StreamSearchEndReason =
  "exhausted" | "repeated-cursor" | "empty-page" | "safety-limit" | "rate-limited" | "cancelled";

export interface SearchStreamsRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  liveOnly: boolean;
  cursor?: string;
}

export interface SearchCategoriesRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  cursor?: string;
}

export interface SearchVideosRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  cursor?: string;
}

export interface SearchVideosResponse<TVideo = unknown> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: TVideo[];
  cursor?: string;
  endReason?: "exhausted" | "safety-limit" | "rate-limited" | "cancelled";
  retryAfterMs?: number;
  retryable: boolean;
  error: SearchPlatformError | null;
  requestCount: number;
  matchedChannelCount: number;
}

export type SearchClipsRequest = SearchVideosRequest;
export type SearchClipsResponse<TClip = unknown> = SearchVideosResponse<TClip>;

export interface SearchCategoriesResponse<TCategory = unknown> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: TCategory[];
  cursor?: string;
  endReason?: "exhausted" | "repeated-cursor" | "cancelled";
  retryable: boolean;
  error: SearchPlatformError | null;
}

export interface SearchStreamsResponse<TStream = unknown> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: TStream[];
  cursor?: string;
  endReason?: StreamSearchEndReason;
  retryAfterMs?: number;
  retryable: boolean;
  error: SearchPlatformError | null;
  scannedPages: number;
  requestCount: number;
}

export type SearchPlatformStatus =
  "loading" | "retrying" | "exhausted" | "limited" | "failed" | "cancelled";

export interface SearchPlatformError {
  platform: Platform;
  message: string;
  code?: string;
}

export interface SearchPlatformEnvelope<TData> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  status: SearchPlatformStatus;
  retryable: boolean;
  error: SearchPlatformError | null;
  data: TData;
}
