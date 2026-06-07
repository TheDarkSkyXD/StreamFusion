/**
 * BetterTTV (BTTV) Emote Provider
 *
 * Fetches emotes from the BetterTTV API including global emotes
 * and channel-specific emotes.
 */

import { api } from "@/lib/api-client";
import type { Emote, EmoteProviderService } from "./emote-types";

/** BTTV emote structure */
interface BTTVEmote {
  id: string;
  code: string;
  imageType: "png" | "gif" | "webp";
  animated: boolean;
  userId?: string;
  user?: {
    id: string;
    name: string;
    displayName: string;
    providerId: string;
  };
}

/** BTTV channel response */
interface BTTVChannelResponse {
  id: string;
  bots: string[];
  avatar: string;
  channelEmotes: BTTVEmote[];
  sharedEmotes: BTTVEmote[];
}

class BTTVEmoteProvider implements EmoteProviderService {
  readonly name = "bttv" as const;

  private static readonly BASE_URL = "https://api.betterttv.net/3";
  private static readonly CDN_URL = "https://cdn.betterttv.net/emote";

  /**
   * Fetch global BTTV emotes
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const data = await api
        .get(`${BTTVEmoteProvider.BASE_URL}/cached/emotes/global`)
        .json<BTTVEmote[]>();
      return data.map((emote) => this.transformEmote(emote, true));
    } catch (error) {
      console.error("[BTTVEmotes] Failed to fetch global emotes:", error);
      throw error;
    }
  }

  /**
   * Fetch channel-specific BTTV emotes
   * @param channelId - Twitch user ID (BTTV only supports Twitch IDs)
   * @param channelName - Optional channel name (unused for BTTV)
   * @param platform - Platform identifier (bttv only supports 'twitch')
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: "twitch" | "kick" = "twitch"
  ): Promise<Emote[]> {
    // BTTV only supports Twitch - skip for other platforms
    if (platform !== "twitch") {
      console.log(`[BTTVEmotes] Skipping - BTTV only supports Twitch channels`);
      return [];
    }

    // Validate channelId looks like a Twitch ID (numeric)
    if (!/^\d+$/.test(channelId)) {
      console.log(`[BTTVEmotes] Skipping - Channel ID ${channelId} is not a valid Twitch ID`);
      return [];
    }

    try {
      const data = await api
        .get(`${BTTVEmoteProvider.BASE_URL}/cached/users/twitch/${channelId}`)
        .json<BTTVChannelResponse>();

      // Combine channel emotes and shared emotes
      const allEmotes = [...data.channelEmotes, ...data.sharedEmotes];

      return allEmotes.map((emote) => this.transformEmote(emote, false, channelId));
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Channel not on BTTV - this is common and expected
        console.log(`[BTTVEmotes] Channel "${channelName || channelId}" has no BTTV emotes`);
        return [];
      }
      console.warn(`[BTTVEmotes] Failed to fetch channel emotes for ${channelId}:`, error);
      return [];
    }
  }

  /**
   * Get URL for a BTTV emote
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
   * Build BTTV emote URL
   */
  static buildEmoteUrl(emoteId: string, size: "1x" | "2x" | "3x" = "2x"): string {
    // Use webp format for smaller file sizes
    return `${BTTVEmoteProvider.CDN_URL}/${emoteId}/${size}.webp`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: BTTVEmote, isGlobal: boolean, channelId?: string): Emote {
    return {
      id: emote.id,
      name: emote.code,
      provider: "bttv",
      isGlobal,
      isAnimated: emote.animated || emote.imageType === "gif",
      isZeroWidth: false,
      channelId,
      urls: {
        url1x: BTTVEmoteProvider.buildEmoteUrl(emote.id, "1x"),
        url2x: BTTVEmoteProvider.buildEmoteUrl(emote.id, "2x"),
        url4x: BTTVEmoteProvider.buildEmoteUrl(emote.id, "3x"),
      },
      owner: emote.user
        ? {
            id: emote.user.id,
            username: emote.user.name,
            displayName: emote.user.displayName,
          }
        : undefined,
    };
  }
}

// Export singleton instance
export const bttvEmoteProvider = new BTTVEmoteProvider();

// Also export class for testing
