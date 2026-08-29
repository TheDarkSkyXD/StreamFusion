/**
 * FrankerFaceZ (FFZ) Emote Provider (renderer side).
 *
 * Channel + global emote fetches go through `electronAPI.emotes.ffz.*` so
 * the REST hop runs in the main process (Electron `net.fetch`). The 404s
 * for Twitch channels with no FFZ room never reach renderer DevTools.
 * See ADR-0004.
 */

// Cross-logger: imported by renderer code via the emotes barrel.
// `@backend/logging/logger` would drag electron-log/main into the
// renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@shared/utils/cross-logger";
import { unwrapIpcReply } from "@/lib/ipc-reply";
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

  private static readonly CDN_URL = "https://cdn.frankerfacez.com/emote";

  async fetchGlobalEmotes(): Promise<Emote[]> {
    try {
      const data = unwrapIpcReply(
        await window.electronAPI.emotes.ffz.getGlobal()
      ) as FFZGlobalResponse | null;
      if (!data) return [];

      const emotes: Emote[] = [];
      for (const setId of data.default_sets) {
        const set = data.sets[setId.toString()];
        if (set?.emoticons) {
          emotes.push(...set.emoticons.map((e) => this.transformEmote(e, true)));
        }
      }
      return emotes;
    } catch (error) {
      logger.warn("Emote:FFZ", "Optional global emotes unavailable", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch channel-specific FFZ emotes. FFZ is Twitch-only — Kick callers
   * get [] without touching the wire. Prefers name lookup over channel id
   * (FFZ name lookups are more reliable per the upstream API contract).
   */
  async fetchChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: "twitch" | "kick" = "twitch"
  ): Promise<Emote[]> {
    if (platform !== "twitch") {
      logger.info("Emote:FFZ", "Skipping - FFZ only supports Twitch channels");
      return [];
    }

    try {
      const request = channelName
        ? ({ kind: "name", name: channelName } as const)
        : ({ kind: "channel-id", channelId } as const);
      const data = unwrapIpcReply(
        await window.electronAPI.emotes.ffz.getRoom(request)
      ) as FFZRoomResponse | null;

      if (!data) {
        logger.info("Emote:FFZ", "Channel has no FFZ emotes", {
          channel: channelName || channelId,
        });
        return [];
      }

      const emotes: Emote[] = [];
      for (const set of Object.values(data.sets)) {
        if (set?.emoticons) {
          emotes.push(...set.emoticons.map((e) => this.transformEmote(e, false, channelId)));
        }
      }
      return emotes;
    } catch (error) {
      logger.warn("Emote:FFZ", "Failed to fetch channel emotes", {
        channel: channelName || channelId,
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

  static buildEmoteUrl(emoteId: number | string, size: "1" | "2" | "4" = "2"): string {
    return `${FFZEmoteProvider.CDN_URL}/${emoteId}/${size}`;
  }

  // ========== Private Methods ==========

  private transformEmote(emote: FFZEmote, isGlobal: boolean, channelId?: string): Emote {
    const id = emote.id.toString();
    const hasAnimated = emote.animated && Object.keys(emote.animated).length > 0;
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
export { FFZEmoteProvider };
