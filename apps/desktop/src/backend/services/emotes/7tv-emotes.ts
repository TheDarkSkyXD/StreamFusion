/**
 * 7TV Emote Provider (renderer side).
 *
 * Channel + global emote fetches go through `electronAPI.emotes.*` so the
 * REST hop runs in the main process (Electron `net.fetch`, Node-side) and
 * the inevitable 404s for Kick users with no linked 7TV account never
 * reach renderer DevTools. See `docs/adr/0004-7tv-rest-in-main-process.md`
 * and PRD #62.
 *
 * `fetchEmoteSet(setId)` still goes through `ky` — it's a separate
 * endpoint not yet wrapped behind IPC (out of scope for slice 2b).
 */

import { api } from "@/lib/api-client";
// Cross-logger: imported by renderer code via the emotes barrel.
// `@backend/logging/logger` would drag electron-log/main into the
// renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@shared/utils/cross-logger";
import { unwrapIpcReply } from "@/lib/ipc-reply";
import type { SevenTvEmoteSet, SevenTvUser } from "@shared/ipc-contracts/third-party-emote-schemas";
import type { Emote, EmoteProviderService } from "./emote-types";

type SevenTVEmote = SevenTvEmoteSet["emotes"][number];
type SevenTVEmoteSet = SevenTvEmoteSet;
type SevenTVUserConnection = SevenTvUser;

/** 7TV emote flags */
const SevenTVEmoteFlags = {
  ZERO_WIDTH_ACTIVE: 1 << 0,
  ZERO_WIDTH_RECOMMENDED: 1 << 8,
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
   * Fetch global 7TV emotes via the main-process IPC handler.
   */
  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const bridge = window.electronAPI?.emotes;
      const data = bridge
        ? unwrapIpcReply(await bridge.get7TVGlobalEmoteSet())
        : await api
            .get(`${SevenTVEmoteProvider.BASE_URL}/emote-sets/global`)
            .json<SevenTVEmoteSet>();

      if (!data?.emotes) {
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
      // KICK connection. Skip the call rather than 404 against the slug or
      // chatroom id (the previous behavior).
      if (!kickUserId) {
        return [];
      }
      identifier = kickUserId;
    }

    try {
      // Main returns the flat UserConnection on 200, or null when 7TV doesn't
      // know this user (the 404 we're trying to keep out of DevTools). Real
      // failures (5xx, network) throw — caught below.
      const bridge = window.electronAPI?.emotes;
      const connection: SevenTvUser | null = bridge
        ? unwrapIpcReply(await bridge.get7TVUserByConnection(platform, identifier))
        : await api
            .get(`${SevenTVEmoteProvider.BASE_URL}/users/${platform.toUpperCase()}/${identifier}`)
            .json<SevenTVUserConnection>();

      if (!connection) {
        logger.info("Emote:7TV", "No 7TV channel emotes", { platform, identifier });
        return [];
      }

      const emotes = connection.emote_set?.emotes;
      if (!emotes) return [];

      return emotes.map((emote) => this.transformEmote(emote, false, channelId));
    } catch (err) {
      logger.warn("Emote:7TV", "Failed to fetch channel emotes", {
        platform,
        identifier,
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      return [];
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
    // The active-set entry owns layout. Base-emote bit 8 is only a recommendation
    // and must not override an explicit active-set flag value.
    const isZeroWidth =
      typeof emote.flags === "number"
        ? (emote.flags & SevenTVEmoteFlags.ZERO_WIDTH_ACTIVE) !== 0
        : (data.flags & SevenTVEmoteFlags.ZERO_WIDTH_RECOMMENDED) !== 0;
    const logicalFile = data.host?.files
      .filter(
        (file) =>
          Number.isFinite(file.width) &&
          file.width > 0 &&
          Number.isFinite(file.height) &&
          file.height > 0
      )
      .toSorted((left, right) => left.width * left.height - right.width * right.height)[0];

    return {
      id: emote.id,
      name: emote.name,
      provider: "7tv",
      isGlobal,
      isAnimated: data.animated,
      isZeroWidth,
      width: logicalFile?.width,
      height: logicalFile?.height,
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
