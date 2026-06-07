/**
 * Twitch Emote Provider
 *
 * Fetches emotes from Twitch's Helix API including global emotes,
 * channel emotes, and emote sets.
 */

import { api } from "@/lib/api-client";
import type { Emote, EmoteProviderService } from "./emote-types";

/** Twitch API emote response */
interface TwitchEmoteResponse {
  id: string;
  name: string;
  images: {
    url_1x: string;
    url_2x: string;
    url_4x: string;
  };
  format: string[];
  scale: string[];
  theme_mode: string[];
  emote_type?: string;
  emote_set_id?: string;
  owner_id?: string;
}

/** Twitch API response wrapper */
interface TwitchApiResponse<T> {
  data: T[];
  template?: string;
}

class TwitchEmoteProvider implements EmoteProviderService {
  readonly name = "twitch" as const;

  private clientId: string = "";
  private accessToken: string = "";
  private isConfigured = false;

  /**
   * Configure the provider with API credentials
   */
  configure(clientId: string, accessToken: string): void {
    this.clientId = clientId;
    this.accessToken = accessToken;
    this.isConfigured = true;
  }

  /**
   * Check if provider is configured
   */
  get configured(): boolean {
    return this.isConfigured && !!this.clientId && !!this.accessToken;
  }

  /**
   * Fetch global Twitch emotes
   */
  /**
   * Fetch global Twitch emotes
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    if (!this.configured) {
      // Expected when user isn't logged in to Twitch - use log not warn
      console.log("[TwitchEmotes] Provider not configured, skipping");
      return [];
    }

    try {
      const data = await api
        .get("https://api.twitch.tv/helix/chat/emotes/global", {
          headers: {
            "Client-ID": this.clientId,
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
        .json<TwitchApiResponse<TwitchEmoteResponse>>();

      return data.data.map((emote) => this.transformEmote(emote, true));
    } catch (error) {
      console.error("[TwitchEmotes] Failed to fetch global emotes:", error);
      throw error;
    }
  }

  /**
   * Fetch channel-specific Twitch emotes
   */
  async fetchChannelEmotes(
    channelId: string,
    _channelName?: string,
    _platform?: "twitch" | "kick" // Ignored - Twitch emotes are only for Twitch
  ): Promise<Emote[]> {
    if (!this.configured) {
      // Expected when user isn't logged in to Twitch - use log not warn
      console.log("[TwitchEmotes] Provider not configured, skipping");
      return [];
    }

    try {
      const data = await api
        .get(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${channelId}`, {
          headers: {
            "Client-ID": this.clientId,
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
        .json<TwitchApiResponse<TwitchEmoteResponse>>();

      return data.data.map((emote) => this.transformEmote(emote, false, channelId));
    } catch (error: any) {
      if (error.response?.status === 404) {
        return []; // Channel has no emotes
      }
      console.error(`[TwitchEmotes] Failed to fetch channel emotes for ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch emotes from a specific emote set
   */
  async fetchEmoteSet(emoteSetId: string): Promise<Emote[]> {
    if (!this.configured) {
      return [];
    }

    try {
      const data = await api
        .get(`https://api.twitch.tv/helix/chat/emotes/set?emote_set_id=${emoteSetId}`, {
          headers: {
            "Client-ID": this.clientId,
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
        .json<TwitchApiResponse<TwitchEmoteResponse>>();

      return data.data.map((emote) => this.transformEmote(emote, false));
    } catch (error) {
      console.error(`[TwitchEmotes] Failed to fetch emote set ${emoteSetId}:`, error);
      throw error;
    }
  }

  /**
   * Get URL for a Twitch emote
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
   * Build Twitch emote URL from ID
   */
  static buildEmoteUrl(
    emoteId: string,
    format: "static" | "animated" | "default" = "default",
    theme: "light" | "dark" = "dark",
    scale: "1.0" | "2.0" | "3.0" = "3.0"
  ): string {
    return `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/${format}/${theme}/${scale}`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: TwitchEmoteResponse, isGlobal: boolean, channelId?: string): Emote {
    // Check if emote has animated format
    const isAnimated = emote.format?.includes("animated") ?? false;

    // Build URLs - prefer animated format if available
    const format = isAnimated ? "animated" : "static";

    return {
      id: emote.id,
      name: emote.name,
      provider: "twitch",
      isGlobal,
      isAnimated,
      isZeroWidth: false,
      channelId,
      urls: {
        url1x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "1.0"),
        url2x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "2.0"),
        url4x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "3.0"),
      },
      owner: emote.owner_id ? { id: emote.owner_id, username: "", displayName: "" } : undefined,
    };
  }
}

// Export singleton instance
export const twitchEmoteProvider = new TwitchEmoteProvider();

// Also export class for testing
