/**
 * Kick Emote Provider
 *
 * Fetches emotes from Kick's API including channel emotes and
 * subscriber emotes.
 */

import { api } from "@/lib/api-client";
import type { Emote, EmoteProviderService } from "./emote-types";

/** Kick emote structure from API */
interface KickEmoteResponse {
  id: number;
  channel_id?: number;
  name: string;
  subscribers_only: boolean;
}

/** Kick channel emotes response */
interface KickChannelEmotesResponse {
  id: number;
  user_id: number;
  slug: string;
  emotes: KickEmoteResponse[];
}

interface KickEmoteSetResponse {
  id: string;
  name: string;
  emotes: KickEmoteResponse[];
}

class KickEmoteProvider implements EmoteProviderService {
  readonly name = "kick" as const;

  private accessToken: string = "";
  private isConfigured = false;

  /**
   * Configure the provider with API credentials
   */
  configure(accessToken: string): void {
    this.accessToken = accessToken;
    this.isConfigured = true;
  }

  /**
   * Check if provider is configured
   */
  get configured(): boolean {
    return this.isConfigured;
  }

  /**
   * Fetch global Kick emotes
   * Note: Kick doesn't have a traditional global emotes endpoint like Twitch.
   * Global emotes are typically loaded from common channels or a shared set.
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    // Kick doesn't expose a public global emotes API
    // Users get their emotes from channels they subscribe to
    // Return empty array - channel emotes will be loaded separately
    return [];
  }

  /**
   * Fetch channel-specific Kick emotes
   * Uses the channel slug or ID to fetch emotes
   */
  /**
   * Fetch channel-specific Kick emotes
   * Uses the channel slug or ID to fetch emotes
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    _platform?: "twitch" | "kick"
  ): Promise<Emote[]> {
    const slug = channelName || channelId;
    const emotes: Emote[] = [];

    // Method 1: Try the dedicated emotes endpoint (used by official web client)
    try {
      const emoteSets = await api
        .get(`https://kick.com/emotes/${slug}`, {
          headers: {
            Accept: "application/json",
          },
        })
        .json<KickEmoteSetResponse[]>();

      if (Array.isArray(emoteSets)) {
        console.log(`[KickEmotes] Found ${emoteSets.length} emote sets for ${slug}`);

        emoteSets.forEach((set) => {
          if (set.emotes && Array.isArray(set.emotes)) {
            set.emotes.forEach((emote) => {
              emotes.push(this.transformEmote(emote, channelId));
            });
          }
        });

        if (emotes.length > 0) {
          return emotes;
        }
      }
    } catch (error) {
      console.warn(`[KickEmotes] Failed to fetch from emotes endpoint for ${slug}:`, error);
    }

    // Method 2: Fallback to v1 channels API
    try {
      const channelData = await api
        .get(`https://kick.com/api/v1/channels/${slug}`, {
          headers: {
            Accept: "application/json",
            ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
          },
        })
        .json<any>();

      let rawEmotes: KickEmoteResponse[] = [];

      if (channelData.emotes && Array.isArray(channelData.emotes)) {
        rawEmotes = channelData.emotes;
      } else if (channelData.chatroom?.emotes && Array.isArray(channelData.chatroom.emotes)) {
        rawEmotes = channelData.chatroom.emotes;
      }

      if (rawEmotes.length > 0) {
        return rawEmotes.map((emote: KickEmoteResponse) => this.transformEmote(emote, channelId));
      }

      return emotes;
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.warn(`[KickEmotes] API returned error for ${slug}:`, error);
      }
      return emotes; // Return whatever we found (empty array if Method 1 failed too)
    }
  }

  /**
   * Get URL for a Kick emote
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
   * Build Kick emote URL from ID
   */
  static buildEmoteUrl(
    emoteId: string | number,
    size: "fullsize" | "1x" | "2x" = "fullsize"
  ): string {
    // Kick uses a different URL structure
    // fullsize is the highest quality
    return `https://files.kick.com/emotes/${emoteId}/${size}`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: KickEmoteResponse, channelId?: string): Emote {
    const id = emote.id.toString();

    // Kick emotes typically only have a 'fullsize' variant exposed reliably
    // We use fullsize for all resolutions to ensure they load
    const fullUrl = KickEmoteProvider.buildEmoteUrl(id, "fullsize");

    return {
      id,
      name: emote.name,
      provider: "kick",
      isGlobal: false, // Kick emotes are always channel-specific
      isAnimated: false, // Kick emotes are typically static
      isZeroWidth: false,
      channelId,
      urls: {
        url1x: fullUrl,
        url2x: fullUrl,
        url4x: fullUrl,
      },
      subscribersOnly: emote.subscribers_only,
    };
  }
}

// Export singleton instance
export const kickEmoteProvider = new KickEmoteProvider();

// Also export class for testing
export { KickEmoteProvider };
