/**
 * Kick Emote Provider
 *
 * Fetches emotes from Kick's API including channel emotes and
 * subscriber emotes.
 */

import { api } from "@/lib/api-client";
// Cross-logger: this module is imported by renderer code via the emotes
// barrel. Using @/backend/logging/logger would drag electron-log/main into
// the renderer bundle and crash with `__dirname is not defined`.
import { logger } from "@/lib/cross-logger";
import { unwrapIpcReply } from "@/lib/ipc-reply";
import type { Emote, EmoteProviderService, KickEmoteSection } from "./emote-types";

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
  name?: string | null;
  emotes: KickEmoteResponse[];
}

interface KickChannelEmotesBridgePayload {
  emoteSets?: unknown;
  channelData?: unknown;
}

type KickSubscriptionResponse = unknown;

interface KickSubscriptionChannel {
  slug: string;
  id?: string;
  displayName?: string;
  avatarUrl?: string;
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
   * Fetch subscriber emotes unlocked by the signed-in Kick user's subscriptions.
   *
   * Kick does not expose this in the public v1 API; this must go through the
   * Electron bridge so the request runs inside the hidden kick.com web session.
   * Calling the v2 endpoint directly from the renderer reliably produces noisy
   * 401s before our catch block can downgrade the failure.
   */
  async fetchUserEmotes(): Promise<Emote[]> {
    const bridge = this.getKickSubscriptionsBridge();
    if (!bridge) {
      return [];
    }

    let subscriptions: KickSubscriptionResponse | null;
    try {
      subscriptions = await bridge();
    } catch (error: unknown) {
      const status = this.getHttpErrorStatus(error);
      if (status === 401 || status === 403) {
        logger.info("Emote:Kick", "User subscription emotes unavailable via Kick web session");
        return [];
      }
      logger.warn("Emote:Kick", "Failed to fetch user subscriptions for emotes", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
    }
    if (subscriptions === null) return [];

    const subscribedChannels = this.extractSubscriptionChannels(subscriptions).slice(0, 50);
    if (subscribedChannels.length === 0) return [];

    const all: Emote[] = [];
    for (const channel of subscribedChannels) {
      const channelEmotes = await this.fetchChannelEmotes(channel.slug, channel.slug, "kick");
      for (const emote of channelEmotes) {
        if (emote.subscribersOnly !== true) continue;
        all.push({
          ...emote,
          isGlobal: true,
          availability: "user",
          kickSection: "subscribed",
          owner: {
            id: channel.id ?? channel.slug,
            username: channel.slug,
            displayName: channel.displayName ?? channel.slug,
            avatarUrl: channel.avatarUrl,
          },
        });
      }
    }

    return this.dedupeEmotes(all);
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
    const bridge = this.getKickChannelEmotesBridge();

    if (bridge) {
      const payload = await bridge({
        slug,
        ...(this.accessToken ? { accessToken: this.accessToken } : {}),
      });
      return this.extractChannelEmotesPayload(payload, channelId);
    }

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
        logger.info("Emote:Kick", "Found emote sets", { count: emoteSets.length, slug });

        emoteSets.forEach((set) => {
          if (set.emotes && Array.isArray(set.emotes)) {
            set.emotes.forEach((emote) => {
              emotes.push(this.transformEmote(emote, channelId, set.name));
            });
          }
        });

        if (emotes.length > 0) {
          return emotes;
        }
      }
    } catch (error) {
      logger.warn("Emote:Kick", "Failed to fetch from emotes endpoint", {
        slug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
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
        .json<unknown>();

      let rawEmotes: KickEmoteResponse[] = [];

      if (this.isKickChannelEmotePayload(channelData)) {
        rawEmotes = Array.isArray(channelData.emotes)
          ? channelData.emotes
          : (channelData.chatroom?.emotes ?? []);
      }

      if (rawEmotes.length > 0) {
        return rawEmotes.map((emote: KickEmoteResponse) => this.transformEmote(emote, channelId));
      }

      return emotes;
    } catch (error: unknown) {
      if (this.getHttpErrorStatus(error) !== 404) {
        logger.warn("Emote:Kick", "API returned error", {
          slug,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
      return emotes; // Return whatever we found (empty array if Method 1 failed too)
    }
  }

  private getHttpErrorStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
    const response = error.response;
    if (typeof response !== "object" || response === null || !("status" in response)) {
      return undefined;
    }
    return typeof response.status === "number" ? response.status : undefined;
  }

  private isKickChannelEmotePayload(
    value: unknown
  ): value is { emotes?: KickEmoteResponse[]; chatroom?: { emotes?: KickEmoteResponse[] } } {
    if (typeof value !== "object" || value === null) return false;
    const emotes = "emotes" in value ? value.emotes : undefined;
    const chatroom = "chatroom" in value ? value.chatroom : undefined;
    const chatroomEmotes =
      typeof chatroom === "object" && chatroom !== null && "emotes" in chatroom
        ? chatroom.emotes
        : undefined;
    return Array.isArray(emotes) || Array.isArray(chatroomEmotes);
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

  private getKickSubscriptionsBridge(): (() => Promise<unknown | null>) | null {
    if (typeof window === "undefined") return null;
    const bridge = window.electronAPI?.emotes?.kick?.getUserSubscriptions;
    return typeof bridge === "function" ? async () => unwrapIpcReply(await bridge()) : null;
  }

  private getKickChannelEmotesBridge():
    | ((params: {
        slug: string;
        accessToken?: string;
      }) => Promise<KickChannelEmotesBridgePayload | null>)
    | null {
    if (typeof window === "undefined") return null;
    const bridge = window.electronAPI?.emotes?.kick?.getChannelEmotes;
    if (typeof bridge !== "function") return null;
    return async (params) =>
      this.asChannelEmotesBridgePayload(unwrapIpcReply(await bridge(params)));
  }

  private extractChannelEmotesPayload(
    payload: KickChannelEmotesBridgePayload | null,
    channelId: string
  ): Emote[] {
    if (!payload) return [];

    const emoteSets = payload.emoteSets;
    if (Array.isArray(emoteSets)) {
      const emotes: Emote[] = [];
      for (const set of emoteSets) {
        const record = this.asRecord(set);
        if (!record) continue;
        const rawEmotes = record?.emotes;
        if (!Array.isArray(rawEmotes)) continue;
        for (const emote of rawEmotes) {
          if (this.isKickEmoteResponse(emote)) {
            emotes.push(this.transformEmote(emote, channelId, this.firstString([record.name])));
          }
        }
      }
      if (emotes.length > 0) return emotes;
    }

    const channelData = this.asRecord(payload.channelData);
    if (!channelData) return [];

    const chatroom = this.asRecord(channelData.chatroom);
    const rawEmotes = Array.isArray(channelData.emotes)
      ? channelData.emotes
      : Array.isArray(chatroom?.emotes)
        ? chatroom.emotes
        : [];

    return rawEmotes
      .filter((emote): emote is KickEmoteResponse => this.isKickEmoteResponse(emote))
      .map((emote) => this.transformEmote(emote, channelId));
  }

  private asChannelEmotesBridgePayload(value: unknown): KickChannelEmotesBridgePayload | null {
    if (!value || typeof value !== "object") return null;
    const payload = value as Record<string, unknown>;
    return {
      emoteSets: payload.emoteSets,
      channelData: payload.channelData,
    };
  }

  private isKickEmoteResponse(value: unknown): value is KickEmoteResponse {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.id === "number" &&
      typeof record.name === "string" &&
      (typeof record.subscribers_only === "boolean" || record.subscribers_only === undefined)
    );
  }

  private getKickSection(setName?: string | null): KickEmoteSection {
    const normalized = (setName || "channel_set").trim().toLowerCase();
    if (normalized === "channel_set") return "channel";
    if (normalized === "emojis") return "emoji";
    return "global";
  }

  private extractSubscriptionChannels(payload: unknown): KickSubscriptionChannel[] {
    const items = this.extractArray(payload);
    if (!items) return [];

    const channels = new Map<string, KickSubscriptionChannel>();
    for (const item of items) {
      const channel = this.extractSubscriptionChannel(item);
      if (channel && !channels.has(channel.slug)) {
        channels.set(channel.slug, channel);
      }
    }
    return [...channels.values()];
  }

  private extractArray(payload: unknown): unknown[] | null {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return null;
    const object = payload as Record<string, unknown>;
    if (Array.isArray(object.data)) return object.data;
    if (Array.isArray(object.subscriptions)) return object.subscriptions;
    return null;
  }

  private extractSubscriptionChannel(item: unknown): KickSubscriptionChannel | null {
    if (!item || typeof item !== "object") return null;
    const object = item as Record<string, unknown>;
    const channel = this.asRecord(object.channel);
    const broadcaster = this.asRecord(object.broadcaster);
    const user =
      this.asRecord(object.user) ??
      this.asRecord(channel?.user) ??
      this.asRecord(broadcaster?.user);

    const slug = this.firstString([
      object.channel_slug,
      object.slug,
      channel?.slug,
      channel?.username,
      channel?.name,
      broadcaster?.slug,
      broadcaster?.username,
      broadcaster?.name,
      user?.slug,
      user?.username,
    ]);
    if (!slug) return null;

    const id = this.firstString([
      object.channel_id,
      object.user_id,
      object.id,
      channel?.id,
      channel?.user_id,
      broadcaster?.id,
      broadcaster?.user_id,
      user?.id,
    ]);
    const displayName = this.firstString([
      object.display_name,
      object.displayName,
      object.name,
      object.username,
      channel?.display_name,
      channel?.displayName,
      channel?.name,
      channel?.username,
      broadcaster?.display_name,
      broadcaster?.displayName,
      broadcaster?.name,
      broadcaster?.username,
      user?.display_name,
      user?.displayName,
      user?.name,
      user?.username,
    ]);
    const avatarUrl = this.firstString([
      object.profile_pic,
      object.profile_picture,
      object.profile_image,
      object.profileImage,
      object.avatar,
      object.avatar_url,
      object.thumbnail,
      channel?.profile_pic,
      channel?.profile_picture,
      channel?.profile_image,
      channel?.profileImage,
      channel?.avatar,
      channel?.avatar_url,
      channel?.thumbnail,
      broadcaster?.profile_pic,
      broadcaster?.profile_picture,
      broadcaster?.profile_image,
      broadcaster?.profileImage,
      broadcaster?.avatar,
      broadcaster?.avatar_url,
      broadcaster?.thumbnail,
      user?.profile_pic,
      user?.profile_picture,
      user?.profile_image,
      user?.profileImage,
      user?.avatar,
      user?.avatar_url,
    ]);

    return { slug, id, displayName, avatarUrl };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  }

  private firstString(values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return value.toString();
    }
    return undefined;
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

  private transformEmote(
    emote: KickEmoteResponse,
    channelId?: string,
    setName?: string | null
  ): Emote {
    const id = emote.id.toString();
    const kickSection = this.getKickSection(setName);

    // Kick emotes typically only have a 'fullsize' variant exposed reliably
    // We use fullsize for all resolutions to ensure they load
    const fullUrl = KickEmoteProvider.buildEmoteUrl(id, "fullsize");

    return {
      id,
      name: emote.name,
      provider: "kick",
      isGlobal: kickSection !== "channel",
      availability: kickSection === "channel" ? "channel" : "global",
      isAnimated: false, // Kick emotes are typically static
      isZeroWidth: false,
      channelId,
      urls: {
        url1x: fullUrl,
        url2x: fullUrl,
        url4x: fullUrl,
      },
      subscribersOnly: emote.subscribers_only,
      kickSection,
    };
  }
}

// Export singleton instance
export const kickEmoteProvider = new KickEmoteProvider();

// Also export class for testing
export { KickEmoteProvider };
