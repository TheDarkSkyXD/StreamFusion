/**
 * FrankerFaceZ (FFZ) Emote Provider
 *
 * Fetches emotes from the FrankerFaceZ API including global emotes
 * and channel-specific emotes.
 */

import { api } from "@/lib/api-client";
import type { Emote, EmoteProviderService } from "./emote-types";

/** FFZ emote structure */
interface FFZEmote {
  id: number;
  name: string;
  height: number;
  width: number;
  public: boolean;
  hidden: boolean;
  modifier: boolean;
  modifier_flags?: number;
  offset?: number;
  margins?: string;
  css?: string;
  owner?: {
    _id: number;
    name: string;
    display_name: string;
  };
  urls: {
    "1"?: string;
    "2"?: string;
    "4"?: string;
  };
  animated?: {
    "1"?: string;
    "2"?: string;
    "4"?: string;
  };
}

/** FFZ emote set */
interface FFZEmoteSet {
  id: number;
  _type: number;
  title: string;
  emoticons: FFZEmote[];
}

/** FFZ global emotes response */
interface FFZGlobalResponse {
  default_sets: number[];
  sets: Record<string, FFZEmoteSet>;
}

/** FFZ channel/room response */
interface FFZRoomResponse {
  room: {
    _id: number;
    twitch_id: number;
    id: string;
    is_group: boolean;
    display_name: string;
    set: number;
    moderator_badge: string | null;
  };
  sets: Record<string, FFZEmoteSet>;
}

class FFZEmoteProvider implements EmoteProviderService {
  readonly name = "ffz" as const;

  private static readonly BASE_URL = "https://api.frankerfacez.com/v1";
  private static readonly CDN_URL = "https://cdn.frankerfacez.com/emote";

  /**
   * Fetch global FFZ emotes
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const data = await api
        .get(`${FFZEmoteProvider.BASE_URL}/set/global`)
        .json<FFZGlobalResponse>();

      // Extract emotes from all default sets
      const emotes: Emote[] = [];
      for (const setId of data.default_sets) {
        const set = data.sets[setId.toString()];
        if (set?.emoticons) {
          emotes.push(...set.emoticons.map((e) => this.transformEmote(e, true)));
        }
      }

      return emotes;
    } catch (error) {
      console.error("[FFZEmotes] Failed to fetch global emotes:", error);
      throw error;
    }
  }

  /**
   * Fetch channel-specific FFZ emotes
   * @param channelId - Twitch user ID (FFZ only supports Twitch)
   * @param channelName - Channel name/login (alternative to ID)
   * @param platform - Platform identifier (ffz only supports 'twitch')
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: "twitch" | "kick" = "twitch"
  ): Promise<Emote[]> {
    // FFZ only supports Twitch - skip for other platforms
    if (platform !== "twitch") {
      console.log(`[FFZEmotes] Skipping - FFZ only supports Twitch channels`);
      return [];
    }

    try {
      // FFZ supports both ID and name lookup
      // Prefer name if available as it's more reliable
      const endpoint = channelName
        ? `${FFZEmoteProvider.BASE_URL}/room/${channelName.toLowerCase()}`
        : `${FFZEmoteProvider.BASE_URL}/room/id/${channelId}`;

      const data = await api.get(endpoint).json<FFZRoomResponse>();

      // Extract emotes from all sets
      const emotes: Emote[] = [];
      for (const set of Object.values(data.sets)) {
        if (set?.emoticons) {
          emotes.push(...set.emoticons.map((e) => this.transformEmote(e, false, channelId)));
        }
      }

      return emotes;
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Channel not on FFZ - this is common and expected
        console.log(`[FFZEmotes] Channel "${channelName || channelId}" has no FFZ emotes`);
        return [];
      }
      console.warn(
        `[FFZEmotes] Failed to fetch channel emotes for ${channelName || channelId}:`,
        error
      );
      return [];
    }
  }

  /**
   * Get URL for an FFZ emote
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
   * Build FFZ emote URL
   */
  static buildEmoteUrl(emoteId: number | string, size: "1" | "2" | "4" = "2"): string {
    return `${FFZEmoteProvider.CDN_URL}/${emoteId}/${size}`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: FFZEmote, isGlobal: boolean, channelId?: string): Emote {
    const id = emote.id.toString();
    const hasAnimated = emote.animated && Object.keys(emote.animated).length > 0;

    // Prefer animated URLs if available
    const urls = hasAnimated && emote.animated ? emote.animated : emote.urls;

    return {
      id,
      name: emote.name,
      provider: "ffz",
      isGlobal,
      isAnimated: !!hasAnimated,
      isZeroWidth: emote.modifier || false,
      channelId,
      urls: {
        url1x: urls["1"] || FFZEmoteProvider.buildEmoteUrl(id, "1"),
        url2x: urls["2"] || FFZEmoteProvider.buildEmoteUrl(id, "2"),
        url4x: urls["4"] || FFZEmoteProvider.buildEmoteUrl(id, "4"),
      },
      owner: emote.owner
        ? {
            id: emote.owner._id.toString(),
            username: emote.owner.name,
            displayName: emote.owner.display_name,
          }
        : undefined,
    };
  }
}

// Export singleton instance
export const ffzEmoteProvider = new FFZEmoteProvider();

// Also export class for testing
