/**
 * 7TV Emote Provider
 *
 * Fetches emotes from the 7TV API (v3) including global emotes
 * and channel-specific emotes.
 *
 * 7TV is the newest and most popular third-party emote provider
 * with features like zero-width emotes and high-quality animated emotes.
 */

// Cross-logger: this module is imported by renderer code via the emotes
// barrel. Using @/backend/logging/logger would drag electron-log/main into
// the renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@/lib/cross-logger";
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
      logger.error("Emote:7TV", "Failed to fetch global emotes", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch channel-specific 7TV emotes (including the channel's custom set).
   *
   * 7TV's `GET /v3/users/{platform}/{id}` is keyed by the platform's *user id*:
   *   - Twitch: the numeric Twitch user id — already what we pass as channelId.
   *   - Kick:   the broadcaster `user_id`. NOT the slug, NOT the channel id,
   *             NOT the chatroom id (all three 404). Resolved upstream from the
   *             Kick channel payload and passed in as `kickUserId`.
   *
   * @param channelId - Emote-map key (Twitch user id, or Kick chatroom/channel id).
   *                    Used to tag returned emotes, not to address 7TV for Kick.
   * @param channelName - Channel name/slug (unused here; kept for interface parity).
   * @param platform - Platform to look up (default: twitch).
   * @param kickUserId - Kick broadcaster user_id; required to resolve Kick emotes.
   */
  async fetchChannelEmotes(
    channelId: string,
    _channelName?: string,
    platform: "twitch" | "kick" = "twitch",
    kickUserId?: string
  ): Promise<Emote[]> {
    let identifier: string;

    if (platform === "twitch") {
      if (!/^\d+$/.test(channelId)) {
        logger.info("Emote:7TV", "Skipping - Channel ID is not a valid Twitch ID", { channelId });
        return [];
      }
      identifier = channelId;
    } else {
      // Kick: without the resolved broadcaster user_id we can't address 7TV's
      // KICK connection. Return nothing rather than 404-spamming the console
      // with the slug or chatroom id (the previous behavior).
      if (!kickUserId) {
        return [];
      }
      identifier = kickUserId;
    }

    const platformName = platform.toUpperCase();

    try {
      // The platform lookup returns a flat UserConnection: `emote_set` sits at
      // the TOP LEVEL. (The `connections[]` array only exists on the 7TV-native
      // /users/{stvId} endpoint, which this is not.)
      const connection = await api
        .get(`${SevenTVEmoteProvider.BASE_URL}/users/${platformName}/${identifier}`)
        .json<SevenTVUserConnection>();

      const emotes = connection?.emote_set?.emotes;
      if (!emotes) {
        return [];
      }

      return emotes.map((emote) => this.transformEmote(emote, false, channelId));
    } catch (err: any) {
      // 404 = channel has no linked 7TV account; not an error worth surfacing.
      if (err.response?.status === 404) {
        logger.info("Emote:7TV", "No 7TV channel emotes", {
          platform: platformName,
          identifier,
        });
        return [];
      }
      logger.warn("Emote:7TV", "Failed to fetch channel emotes", {
        platform: platformName,
        identifier,
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
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
      logger.error("Emote:7TV", "Failed to fetch emote set", {
        setId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
