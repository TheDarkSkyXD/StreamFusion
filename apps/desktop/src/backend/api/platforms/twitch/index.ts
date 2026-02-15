/**
 * Twitch API Module Index
 *
 * Exports all Twitch-specific API types, transformers, and clients.
 */

// Client (hybrid GQL + Helix)
export {
  type PaginatedResult,
  type PaginationOptions,
  type TwitchClientError,
  twitchClient,
} from "./twitch-client";

// GQL Client (public data, no API key)
export * as TwitchGql from "./twitch-gql-client";

// Transformers
export {
  transformTwitchCategory,
  transformTwitchChannel,
  transformTwitchClip,
  transformTwitchFollow,
  transformTwitchSearchChannel,
  transformTwitchStream,
  transformTwitchUser,
  transformTwitchUserToChannel,
  transformTwitchVideo,
} from "./twitch-transformers";

// Twitch API Types
export type {
  TwitchApiChannel,
  TwitchApiClip,
  TwitchApiFollow,
  TwitchApiFollowedChannel,
  TwitchApiGame,
  TwitchApiResponse,
  TwitchApiSearchChannel,
  TwitchApiStream,
  TwitchApiUser,
  TwitchApiVideo,
  TwitchTokenValidation,
} from "./twitch-types";
export { TWITCH_API_BASE, TWITCH_AUTH_BASE } from "./twitch-types";
