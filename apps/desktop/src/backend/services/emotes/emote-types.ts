/**
 * Emote System Types
 *
 * Shared type definitions for the emote provider system.
 */

/** Supported emote providers */
export type EmoteProvider = "twitch" | "kick" | "bttv" | "ffz" | "7tv";

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
  /** Whether this is an animated emote (GIF/WEBP) */
  isAnimated: boolean;
  /** Whether this is a zero-width emote (overlays previous emote) */
  isZeroWidth: boolean;
  /** Channel ID this emote belongs to (if channel-specific) */
  channelId?: string;
  /** URL templates for different sizes */
  urls: EmoteUrls;
  /** Owner information (for 7TV, etc.) */
  owner?: EmoteOwner;
  /** Kick subscriber-only flag. Present on Kick emotes; absent elsewhere. */
  subscribersOnly?: boolean;
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

  /** Fetch channel-specific emotes */
  fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform?: "twitch" | "kick"
  ): Promise<Emote[]>;

  /** Get URL for an emote at a specific size */
  getEmoteUrl(emote: Emote, size: "1x" | "2x" | "4x"): string;
}

/** Emote manager configuration */
export interface EmoteManagerConfig {
  /** Whether to load global emotes on init */
  loadGlobalOnInit: boolean;
  /** Providers to enable */
  enabledProviders: EmoteProvider[];
  /** Cache TTL in milliseconds */
  cacheTTL: number;
}

/** Default emote manager configuration */
export const DEFAULT_EMOTE_CONFIG: EmoteManagerConfig = {
  loadGlobalOnInit: true,
  enabledProviders: ["twitch", "kick", "bttv", "ffz", "7tv"],
  cacheTTL: 30 * 60 * 1000, // 30 minutes
};
