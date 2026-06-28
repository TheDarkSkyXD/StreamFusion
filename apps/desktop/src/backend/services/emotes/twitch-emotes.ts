/**
 * Twitch Emote Provider
 *
 * Fetches emotes from Twitch's Helix API including global emotes,
 * channel emotes, and emote sets.
 */

import { api } from "@/lib/api-client";
// Cross-logger: this module is imported by renderer code via the emotes
// barrel. Using @/backend/logging/logger would drag electron-log/main into
// the renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@/lib/cross-logger";
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
  pagination?: {
    cursor?: string;
  };
}

interface TwitchUserResponse {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

const TWITCH_USER_EMOTE_SCOPE = "user:read:emotes";

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

  private async getFreshAccessToken(): Promise<string | null> {
    if (!this.clientId) return null;

    const authApi = typeof window !== "undefined" ? window.electronAPI?.auth : undefined;
    if (authApi?.getValidTwitchToken) {
      try {
        const freshToken = await authApi.getValidTwitchToken();
        if (freshToken) {
          this.accessToken = freshToken;
          this.isConfigured = true;
          return freshToken;
        }
      } catch (error) {
        logger.warn("Emote:Twitch", "Failed to refresh token before emote fetch", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.accessToken || null;
  }

  private markUnauthorized(): void {
    this.accessToken = "";
    this.isConfigured = false;
  }

  /**
   * Fetch global Twitch emotes
   */
  /**
   * Fetch global Twitch emotes
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    if (!this.configured) {
      // Expected when user isn't logged in to Twitch - use info not warn
      logger.info("Emote:Twitch", "Provider not configured, skipping");
      return [];
    }

    try {
      const accessToken = await this.getFreshAccessToken();
      if (!accessToken) return [];

      const data = await api
        .get("https://api.twitch.tv/helix/chat/emotes/global", {
          headers: {
            "Client-ID": this.clientId,
            Authorization: `Bearer ${accessToken}`,
          },
        })
        .json<TwitchApiResponse<TwitchEmoteResponse>>();

      return data.data.map((emote) => this.transformEmote(emote, true, undefined, "global"));
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.markUnauthorized();
      }
      logger.warn("Emote:Twitch", "Failed to fetch global emotes", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
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
      // Expected when user isn't logged in to Twitch - use info not warn
      logger.info("Emote:Twitch", "Provider not configured, skipping");
      return [];
    }

    try {
      const accessToken = await this.getFreshAccessToken();
      if (!accessToken) return [];

      const data = await api
        .get(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${channelId}`, {
          headers: {
            "Client-ID": this.clientId,
            Authorization: `Bearer ${accessToken}`,
          },
        })
        .json<TwitchApiResponse<TwitchEmoteResponse>>();

      return data.data.map((emote) => this.transformEmote(emote, false, channelId, "channel"));
    } catch (error: any) {
      if (error.response?.status === 404) {
        return []; // Channel has no emotes
      }
      if (error.response?.status === 401) {
        this.markUnauthorized();
      }
      logger.warn("Emote:Twitch", "Failed to fetch channel emotes", {
        channelId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
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

      return data.data.map((emote) => this.transformEmote(emote, false, undefined, "channel"));
    } catch (error) {
      logger.error("Emote:Twitch", "Failed to fetch emote set", {
        emoteSetId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch emotes the signed-in Twitch user can use in any chat.
   * Requires the `user:read:emotes` scope on the user's token.
   */
  async fetchUserEmotes(): Promise<Emote[]> {
    if (!this.configured) {
      return [];
    }

    const authApi = typeof window !== "undefined" ? window.electronAPI?.auth : undefined;
    if (authApi?.tokenStatus) {
      try {
        const status = await authApi.tokenStatus("twitch");
        const hasUserEmoteScope = (status.scopes ?? []).includes(TWITCH_USER_EMOTE_SCOPE);
        if (status.connected === true && status.valid === true && !hasUserEmoteScope) {
          logger.info("Emote:Twitch", "Skipping user emotes; token lacks user:read:emotes");
          return [];
        }
      } catch (error) {
        logger.debug("Emote:Twitch", "Could not pre-check user emote scope", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const twitchUser = await authApi?.getTwitchUser?.();
    if (!twitchUser?.id) {
      return [];
    }

    try {
      const accessToken = await this.getFreshAccessToken();
      if (!accessToken) return [];

      const emotes: Emote[] = [];
      let cursor: string | undefined;

      do {
        const url = new URL("https://api.twitch.tv/helix/chat/emotes/user");
        url.searchParams.set("user_id", twitchUser.id);
        if (cursor) url.searchParams.set("after", cursor);

        const page = await api
          .get(url.toString(), {
            headers: {
              "Client-ID": this.clientId,
              Authorization: `Bearer ${accessToken}`,
            },
          })
          .json<TwitchApiResponse<TwitchEmoteResponse>>();

        for (const emote of page.data) {
          if (this.isGlobalUserEmote(emote)) continue;
          emotes.push(this.transformEmote(emote, false, undefined, "user"));
        }
        cursor = page.pagination?.cursor;
      } while (cursor);

      const ownerIds = [
        ...new Set(emotes.map((emote) => emote.owner?.id).filter((id): id is string => !!id)),
      ];
      const owners = await this.fetchUserMetadata(ownerIds, accessToken);

      return this.dedupeEmotes(
        emotes.map((emote) => {
          if (!emote.owner?.id) return emote;
          const owner = owners.get(emote.owner.id);
          return owner ? { ...emote, owner } : emote;
        })
      );
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        logger.info("Emote:Twitch", "User emotes unavailable; token may need user:read:emotes");
        return [];
      }
      logger.warn("Emote:Twitch", "Failed to fetch user emotes", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
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

  private isGlobalUserEmote(emote: TwitchEmoteResponse): boolean {
    const type = (emote.emote_type ?? "").toLowerCase();
    return type === "global" || type === "globals";
  }

  private dedupeEmotes(emotes: Emote[]): Emote[] {
    const seen = new Set<string>();
    const deduped: Emote[] = [];
    for (const emote of emotes) {
      if (seen.has(emote.id)) continue;
      seen.add(emote.id);
      deduped.push(emote);
    }
    return deduped;
  }

  private async fetchUserMetadata(
    userIds: string[],
    accessToken: string
  ): Promise<Map<string, NonNullable<Emote["owner"]>>> {
    const owners = new Map<string, NonNullable<Emote["owner"]>>();
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100);
      if (batch.length === 0) continue;

      const url = new URL("https://api.twitch.tv/helix/users");
      for (const id of batch) {
        url.searchParams.append("id", id);
      }

      try {
        const page = await api
          .get(url.toString(), {
            headers: {
              "Client-ID": this.clientId,
              Authorization: `Bearer ${accessToken}`,
            },
          })
          .json<TwitchApiResponse<TwitchUserResponse>>();

        for (const user of page.data) {
          owners.set(user.id, {
            id: user.id,
            username: user.login,
            displayName: user.display_name || user.login,
            avatarUrl: user.profile_image_url || undefined,
          });
        }
      } catch (error) {
        logger.warn("Emote:Twitch", "Failed to fetch user emote owner metadata", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }
    return owners;
  }

  private transformEmote(
    emote: TwitchEmoteResponse,
    isGlobal: boolean,
    channelId?: string,
    availability: Emote["availability"] = isGlobal ? "global" : "channel"
  ): Emote {
    // Check if emote has animated format
    const isAnimated = emote.format?.includes("animated") ?? false;

    // Build URLs - prefer animated format if available
    const format = isAnimated ? "animated" : "static";

    return {
      id: emote.id,
      name: emote.name,
      provider: "twitch",
      isGlobal,
      availability,
      isAnimated,
      isZeroWidth: false,
      channelId,
      urls: {
        url1x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "1.0"),
        url2x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "2.0"),
        url4x: TwitchEmoteProvider.buildEmoteUrl(emote.id, format, "dark", "3.0"),
      },
      owner: emote.owner_id ? { id: emote.owner_id, username: "", displayName: "" } : undefined,
      subscribersOnly: (emote.emote_type ?? "").toLowerCase() === "subscriptions",
    };
  }
}

// Export singleton instance
export const twitchEmoteProvider = new TwitchEmoteProvider();

// Also export class for testing
