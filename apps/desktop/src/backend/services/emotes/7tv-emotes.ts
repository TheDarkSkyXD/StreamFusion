/**
 * 7TV Emote Provider
 *
 * Fetches emotes from the 7TV API (v3) including global emotes
 * and channel-specific emotes.
 *
 * 7TV is the newest and most popular third-party emote provider
 * with features like zero-width emotes and high-quality animated emotes.
 */

import { api } from "@/lib/api-client";
import type { Emote, EmoteProviderService } from "./emote-types";

/** 7TV emote file structure */
interface SevenTVEmoteFile {
  name: string;
  static_name: string;
  width: number;
  height: number;
  frame_count: number;
  size: number;
  format: "AVIF" | "WEBP" | "PNG" | "GIF";
}

/** 7TV emote host structure */
interface SevenTVEmoteHost {
  url: string;
  files: SevenTVEmoteFile[];
}

/** 7TV emote data structure */
interface SevenTVEmoteData {
  id: string;
  name: string;
  flags: number;
  lifecycle: number;
  state: string[];
  listed: boolean;
  animated: boolean;
  owner?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
  host: SevenTVEmoteHost;
}

/** 7TV emote wrapper (in emote sets) */
interface SevenTVEmote {
  id: string;
  name: string;
  flags: number;
  timestamp: number;
  actor_id: string | null;
  data: SevenTVEmoteData;
}

/** 7TV emote set */
interface SevenTVEmoteSet {
  id: string;
  name: string;
  flags: number;
  tags: string[];
  immutable: boolean;
  privileged: boolean;
  emotes: SevenTVEmote[];
  emote_count: number;
  capacity: number;
  owner?: {
    id: string;
    username: string;
    display_name: string;
  };
}

/** 7TV user connection (platform link) */
interface SevenTVUserConnection {
  id: string;
  platform: "TWITCH" | "YOUTUBE" | "DISCORD" | "KICK";
  username: string;
  display_name: string;
  linked_at: number;
  emote_capacity: number;
  emote_set_id: string | null;
  emote_set: SevenTVEmoteSet | null;
}

/** 7TV user response */
interface SevenTVUserResponse {
  id: string;
  username: string;
  display_name: string;
  connections: SevenTVUserConnection[];
}

/** 7TV emote flags */
const SevenTVEmoteFlags = {
  ZERO_WIDTH: 1 << 8, // 256
  PRIVATE: 1 << 0, // 1
  AUTHENTIC: 1 << 1, // 2
};

class SevenTVEmoteProvider implements EmoteProviderService {
  readonly name = "7tv" as const;

  private static readonly BASE_URL = "https://7tv.io/v3";
  private static readonly CDN_URL = "https://cdn.7tv.app/emote";

  /** Preferred image format */
  private format: "webp" | "avif" = "webp";

  /**
   * Set preferred image format
   */
  setFormat(format: "webp" | "avif"): void {
    this.format = format;
  }

  /**
   * Fetch global 7TV emotes
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const data = await api
        .get(`${SevenTVEmoteProvider.BASE_URL}/emote-sets/global`)
        .json<SevenTVEmoteSet>();

      if (!data.emotes) {
        return [];
      }

      return data.emotes.map((emote) => this.transformEmote(emote, true));
    } catch (error) {
      console.error("[7TVEmotes] Failed to fetch global emotes:", error);
      throw error;
    }
  }

  /**
   * Fetch channel-specific 7TV emotes
   * @param channelId - Platform user ID (for Twitch) or chatroom ID (for Kick)
   * @param channelName - Channel name/slug (required for Kick)
   * @param platform - Platform to look up (default: twitch)
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: "twitch" | "kick" = "twitch"
  ): Promise<Emote[]> {
    // Determine the correct identifier for each platform
    let identifier: string;

    if (platform === "twitch") {
      // For Twitch, use the numeric user ID
      if (!/^\d+$/.test(channelId)) {
        console.log(`[7TVEmotes] Skipping - Channel ID ${channelId} is not a valid Twitch ID`);
        return [];
      }
      identifier = channelId;
    } else {
      // For Kick, 7TV expects the channel slug/username, not the chatroom ID
      if (channelName) {
        identifier = channelName.toLowerCase();
      } else if (!/^\d+$/.test(channelId)) {
        // If channelId is not numeric, assume it's a slug
        identifier = channelId.toLowerCase();
      } else {
        // Numeric chatroom ID won't work with 7TV - skip silently
        return [];
      }
    }

    try {
      // 7TV uses platform connections to find users
      const platformName = platform.toUpperCase();

      try {
        const userData = await api
          .get(`${SevenTVEmoteProvider.BASE_URL}/users/${platformName}/${identifier}`)
          .json<SevenTVUserResponse>();

        // Find the correct platform connection
        const connection = userData.connections?.find((c) => c.platform === platformName);

        if (!connection?.emote_set?.emotes) {
          return [];
        }

        return connection.emote_set.emotes.map((emote) =>
          this.transformEmote(emote, false, channelId)
        );
      } catch (err: any) {
        // Handle 404 cleanly (user not found)
        if (err.response?.status === 404) {
          console.log(`[7TVEmotes] Channel "${identifier}" has no 7TV emotes`);
          return [];
        }
        throw err;
      }
    } catch (error) {
      console.warn(`[7TVEmotes] Failed to fetch channel emotes for ${identifier}:`, error);
      return []; // Fail silently for individual channels so we don't crash
    }
  }

  /**
   * Fetch emotes from a specific emote set by ID
   */
  async fetchEmoteSet(setId: string): Promise<Emote[]> {
    try {
      const data = await api
        .get(`${SevenTVEmoteProvider.BASE_URL}/emote-sets/${setId}`)
        .json<SevenTVEmoteSet>();

      if (!data.emotes) {
        return [];
      }

      return data.emotes.map((emote) => this.transformEmote(emote, false));
    } catch (error) {
      console.error(`[7TVEmotes] Failed to fetch emote set ${setId}:`, error);
      return [];
    }
  }

  /**
   * Get URL for a 7TV emote
   */
  getEmoteUrl(emote: Emote, size: "1x" | "2x" | "4x" = "2x"): string {
    switch (size) {
      case "1x":
        return emote.urls.url1x;
      case "2x":
        return emote.urls.url2x;
      case "4x":
        return emote.urls.url4x || emote.urls.url2x;
      default:
        return emote.urls.url2x;
    }
  }

  /**
   * Build 7TV emote URL
   * @param emoteId - Emote ID
   * @param size - Size (1x, 2x, 3x, 4x)
   * @param format - Image format (webp, avif)
   */
  static buildEmoteUrl(
    emoteId: string,
    size: "1x" | "2x" | "3x" | "4x" = "2x",
    format: "webp" | "avif" = "webp"
  ): string {
    return `${SevenTVEmoteProvider.CDN_URL}/${emoteId}/${size}.${format}`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: SevenTVEmote, isGlobal: boolean, channelId?: string): Emote {
    const data = emote.data;
    const isZeroWidth = (data.flags & SevenTVEmoteFlags.ZERO_WIDTH) !== 0;

    return {
      id: emote.id,
      name: emote.name,
      provider: "7tv",
      isGlobal,
      isAnimated: data.animated,
      isZeroWidth,
      channelId,
      urls: {
        url1x: SevenTVEmoteProvider.buildEmoteUrl(data.id, "1x", this.format),
        url2x: SevenTVEmoteProvider.buildEmoteUrl(data.id, "2x", this.format),
        url4x: SevenTVEmoteProvider.buildEmoteUrl(data.id, "4x", this.format),
      },
      owner: data.owner
        ? {
            id: data.owner.id,
            username: data.owner.username,
            displayName: data.owner.display_name,
          }
        : undefined,
      addedAt: emote.timestamp > 0 ? emote.timestamp : undefined,
    };
  }
}

// Export singleton instance
export const sevenTVEmoteProvider = new SevenTVEmoteProvider();

// Also export class for testing
export { SevenTVEmoteProvider };
