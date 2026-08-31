/**
 * Emote System Types
 *
 * Shared type definitions for the emote provider system.
 */

import type { Platform } from "@shared/auth-types";

/** Supported emote providers */
export type EmoteProvider = "twitch" | "kick" | "bttv" | "ffz" | "7tv";

export type KickEmoteSection = "channel" | "subscribed" | "global" | "emoji";

export type EmoteAvailability = "global" | "channel" | "user";

/** Emote data structure */
export interface Emote {
  /** Unique identifier for the emote */
  id: string;
  /** Emote code/name used in chat */
  name: string;
  /** Provider of the emote */
  provider: EmoteProvider;
  /** Whether this is a global emote (vs channel-specific) */
  isGlobal: boolean;
  /** Where this emote came from: platform global, current channel, or the signed-in user's usable library. */
  availability?: EmoteAvailability;
  /** Whether this is an animated emote (GIF/WEBP) */
  isAnimated: boolean;
  /** Whether this is a zero-width emote (overlays previous emote) */
  isZeroWidth: boolean;
  /** Provider logical 1x geometry. Density variants must not change layout size. */
  width?: number;
  height?: number;
  /** Channel ID this emote belongs to (if channel-specific) */
  channelId?: string;
  /** URL templates for different sizes */
  urls: EmoteUrls;
  /** Owner information (for 7TV, etc.) */
  owner?: EmoteOwner;
  /** Kick subscriber-only flag. Present on Kick emotes; absent elsewhere. */
  subscribersOnly?: boolean;
  /**
   * Kick's /emotes/{channel} response is grouped by set name:
   * channel_set, Global, and Emojis. Preserve that source section so the picker
   * can render KickTalk-style separate sections instead of flattening globals.
   */
  kickSection?: KickEmoteSection;
  /**
   * When the emote was added to its set (7TV only), as a Unix-ms timestamp.
   * 7TV's `ActiveEmote.timestamp` field — the "Added on" date KickTalk surfaces.
   * Absent for global emotes whose set carries no per-emote timestamp.
   */
  addedAt?: number;
}

/** Emote URL templates for different sizes */
export interface EmoteUrls {
  /** 1x size (usually 28px) */
  url1x: string;
  /** 2x size (usually 56px) */
  url2x: string;
  /** 3x/4x size (usually 112px) - optional */
  url4x?: string;
}

/** Emote owner information */
export interface EmoteOwner {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** Emote set - a collection of emotes */
export interface EmoteSet {
  /** Unique set identifier */
  id: string;
  /** Set name/label */
  name: string;
  /** Provider of the set */
  provider: EmoteProvider;
  /** Whether this is a global set */
  isGlobal: boolean;
  /** Channel ID if channel-specific */
  channelId?: string;
  /** Emotes in this set */
  emotes: Emote[];
}

/** Emote provider interface - all providers must implement this */
export interface EmoteProviderService {
  /** Provider name */
  readonly name: EmoteProvider;

  /** Fetch global emotes from this provider */
  fetchGlobalEmotes(): Promise<Emote[]>;

  /** Fetch emotes the signed-in user can use across channels, when supported. */
  fetchUserEmotes?(): Promise<Emote[]>;

  /**
   * Fetch channel-specific emotes.
   * @param kickUserId - Kick broadcaster user_id. Only the 7TV provider consumes
   *   it (7TV's KICK connection is keyed by the user_id, which differs from the
   *   chatroom/channel id used as `channelId`). Other providers ignore it.
   */
  fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform?: Platform,
    kickUserId?: string
  ): Promise<Emote[]>;

  /** Get URL for an emote at a specific size */
  getEmoteUrl(emote: Emote, size: "1x" | "2x" | "4x"): string;
}

/** Emote manager configuration */
export interface EmoteManagerConfig {
  /** Providers to enable */
  enabledProviders: EmoteProvider[];
  /** Cache TTL in milliseconds */
  cacheTTL: number;
}

/** Default emote manager configuration */
export const DEFAULT_EMOTE_CONFIG: EmoteManagerConfig = {
  enabledProviders: ["twitch", "kick", "bttv", "ffz", "7tv"],
  cacheTTL: 30 * 60 * 1000, // 30 minutes
};
