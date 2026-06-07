/**
 * Unified API Module Index
 *
 * Exports all unified types and interfaces for platform-agnostic API access.
 */

export type { ChannelRef } from "./channel-ref";
export { idRef, slugRef } from "./channel-ref";
// Platform client interface
export type {
  IPlatformClient,
  PlatformClientFactory,
  StreamPlaybackInfo,
  StreamQuality,
} from "./platform-client";
export type {
  IPlatformReader,
  PageOptions,
  PageResult,
  TopStreamsOptions,
} from "./platform-reader";
// Platform types
export type {
  ApiError,
  ApiResponse,
  ChatBadge,
  PaginationParams,
  ParsedMessagePart,
  SearchResults,
  SocialLink,
  UnifiedCategory,
  UnifiedChannel,
  UnifiedChatMessage,
  UnifiedClip,
  UnifiedFollow,
  UnifiedStream,
  UnifiedUser,
  UnifiedVideo,
} from "./platform-types";
export { clients } from "./registry";
