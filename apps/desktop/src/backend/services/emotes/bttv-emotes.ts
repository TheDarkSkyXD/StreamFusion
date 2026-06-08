/**
 * BetterTTV (BTTV) Emote Provider (renderer side).
 *
 * Channel + global emote fetches go through `electronAPI.emotes.bttv.*` so
 * the REST hop runs in the main process (Electron `net.fetch`). The 404s
 * for Twitch channels with no BTTV emote set never reach renderer
 * DevTools. See ADR-0004.
 */

// Cross-logger: imported by renderer code via the emotes barrel.
// `@/backend/logging/logger` would drag electron-log/main into the
// renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@/lib/cross-logger";
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

  private static readonly CDN_URL = "https://cdn.betterttv.net/emote";

  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const data = (await window.electronAPI.emotes.bttv.getGlobal()) as BTTVEmote[] | null;
      if (!data) return [];
      return data.map((emote) => this.transformEmote(emote, true));
    } catch (error) {
      logger.error("Emote:BTTV", "Failed to fetch global emotes", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch channel-specific BTTV emotes. BTTV is Twitch-only — Kick callers
   * get an empty array without touching the wire. Non-numeric channel ids
   * also short-circuit because BTTV expects the numeric Twitch user id.
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: "twitch" | "kick" = "twitch"
  ): Promise<Emote[]> {
    if (platform !== "twitch") {
      logger.info("Emote:BTTV", "Skipping - BTTV only supports Twitch channels");
      return [];
    }
    if (!/^\d+$/.test(channelId)) {
      logger.info("Emote:BTTV", "Skipping - Channel ID is not a valid Twitch ID", { channelId });
      return [];
    }

    try {
      const data = (await window.electronAPI.emotes.bttv.getUserByTwitchId(
        channelId
      )) as BTTVChannelResponse | null;

      if (!data) {
        logger.info("Emote:BTTV", "Channel has no BTTV emotes", {
          channel: channelName || channelId,
        });
        return [];
      }

      const allEmotes = [...data.channelEmotes, ...data.sharedEmotes];
      return allEmotes.map((emote) => this.transformEmote(emote, false, channelId));
    } catch (error) {
      logger.warn("Emote:BTTV", "Failed to fetch channel emotes", {
        channelId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
    }
  }

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

  static buildEmoteUrl(emoteId: string, size: "1x" | "2x" | "3x" = "2x"): string {
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
export { BTTVEmoteProvider };
