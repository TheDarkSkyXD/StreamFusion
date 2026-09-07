import { logger } from "@backend/logging/logger";
import type { TwitchBadgeCatalog, TwitchBadgeCatalogSource } from "@shared/chat-types";
import {
  hasValidTwitchBadgeSets,
  toTwitchBadgeCatalogSection,
  toTwitchBadgeSets,
  type TwitchBadgeSetShape,
} from "@shared/twitch-badge-catalog";

import type { TwitchBadgeCatalogReader } from "../../capabilities/twitch-badge-catalog-reader";

const HELIX_URL = "https://api.twitch.tv/helix";
const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const CACHE_TTL_MS = 60 * 60 * 1000;

type LoadedSets = { sets: TwitchBadgeSetShape[]; source: TwitchBadgeCatalogSource };

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

function flattenedBadges(values: Array<Record<string, unknown> | null | undefined>): TwitchBadgeSetShape[] {
  return toTwitchBadgeSets(
    values.map((badge) =>
      badge
        ? {
            setId: typeof badge.setID === "string" ? badge.setID : null,
            version: typeof badge.version === "string" ? badge.version : null,
            imageUrl1x: typeof badge.image1x === "string" ? badge.image1x : badge.imageURL as string | null,
            imageUrl2x: typeof badge.image2x === "string" ? badge.image2x : badge.imageURL as string | null,
            imageUrl4x: typeof badge.image4x === "string" ? badge.image4x : badge.imageURL as string | null,
            title: typeof badge.title === "string" ? badge.title : null,
          }
        : null
    )
  );
}

export class TwitchBadgeCatalogProvider implements TwitchBadgeCatalogReader {
  private global: { loadedAt: number; value: LoadedSets } | null = null;
  private channels = new Map<string, { loadedAt: number; value: LoadedSets }>();

  async loadBadgeCatalog(
    broadcasterId: string,
    channelLogin: string,
    credentials: { accessToken: string; clientId: string },
    options: { forceRefresh?: boolean } = {}
  ): Promise<TwitchBadgeCatalog | null> {
    try {
      const global = await this.loadGlobal(credentials, options.forceRefresh === true);
      const channel = await this.loadChannel(broadcasterId, channelLogin, credentials, options.forceRefresh === true);
      return {
        global: toTwitchBadgeCatalogSection(global.sets, global.source),
        channel: toTwitchBadgeCatalogSection(channel.sets, channel.source),
      };
    } catch (error) {
      logger.debug("IPC:Chat", "Twitch badge catalog provider failed", {
        broadcasterId,
        channelLogin,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async loadGlobal(credentials: { accessToken: string; clientId: string }, forceRefresh: boolean): Promise<LoadedSets> {
    if (!forceRefresh && this.global && Date.now() - this.global.loadedAt < CACHE_TTL_MS) return this.global.value;
    const value = await this.fetchGlobal(credentials);
    this.global = { loadedAt: Date.now(), value };
    return value;
  }

  private async loadChannel(
    broadcasterId: string,
    channelLogin: string,
    credentials: { accessToken: string; clientId: string },
    forceRefresh: boolean
  ): Promise<LoadedSets> {
    const cached = this.channels.get(broadcasterId);
    if (!forceRefresh && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.value;
    const value = await this.fetchChannel(broadcasterId, channelLogin, credentials);
    this.channels.delete(broadcasterId);
    this.channels.set(broadcasterId, { loadedAt: Date.now(), value });
    while (this.channels.size > 20) this.channels.delete(this.channels.keys().next().value as string);
    return value;
  }

  private async fetchGlobal(credentials: { accessToken: string; clientId: string }): Promise<LoadedSets> {
    try {
      const response = await this.gql<{ badges?: Array<Record<string, unknown> | null> }>({
        operationName: "Badges",
        variables: { quality: "QUADRUPLE" },
        query: "query Badges($quality: BadgeImageSize) { badges { imageURL(size: $quality) setID title version } }",
      });
      const sets = flattenedBadges(response.data?.badges ?? []);
      if (hasValidTwitchBadgeSets(sets)) return { sets, source: "gql" };
    } catch { /* Helix is the authenticated fallback. */ }
    try {
      const sets = await this.fetchChatListBadges("");
      if (hasValidTwitchBadgeSets(sets)) return { sets, source: "persisted-gql" };
    } catch { /* Helix is the authenticated fallback. */ }
    const sets = await this.helix("/chat/badges/global", credentials);
    if (!hasValidTwitchBadgeSets(sets)) throw new Error("Twitch global badge response was empty");
    return { sets, source: "helix" };
  }

  private async fetchChannel(
    broadcasterId: string,
    channelLogin: string,
    credentials: { accessToken: string; clientId: string }
  ): Promise<LoadedSets> {
    try {
      const response = await this.gql<{ user?: { broadcastBadges?: Array<Record<string, unknown> | null> } | null }>({
        operationName: "UserBadges",
        variables: { id: broadcasterId, login: channelLogin, quality: "QUADRUPLE" },
        query: "query UserBadges($id: ID, $login: String, $quality: BadgeImageSize) { user(id: $id, login: $login, lookupType: ALL) { broadcastBadges { imageURL(size: $quality) setID title version } } }",
      });
      const sets = flattenedBadges(response.data?.user?.broadcastBadges ?? []);
      if (hasValidTwitchBadgeSets(sets)) return { sets, source: "gql" };
    } catch { /* Helix is the authenticated fallback. */ }
    try {
      const sets = await this.fetchChatListBadges(channelLogin);
      if (hasValidTwitchBadgeSets(sets)) return { sets, source: "persisted-gql" };
    } catch { /* Helix is the authenticated fallback. */ }
    return {
      sets: await this.helix(`/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`, credentials),
      source: "helix",
    };
  }

  private async gql<T>(body: Record<string, unknown>): Promise<GqlResponse<T>> {
    const response = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-Id": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twitch badge GQL ${response.status}`);
    const data = await response.json() as GqlResponse<T>;
    if (data.errors?.length) throw new Error(data.errors.map((error) => error.message ?? "unknown").join("; "));
    return data;
  }

  private async helix(endpoint: string, credentials: { accessToken: string; clientId: string }): Promise<TwitchBadgeSetShape[]> {
    if (!credentials.accessToken || !credentials.clientId) throw new Error("No Twitch credentials for badge fallback");
    const response = await fetch(`${HELIX_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-Id": credentials.clientId },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twitch badge Helix ${response.status}`);
    const data = await response.json() as { data?: TwitchBadgeSetShape[] };
    return data.data ?? [];
  }

  private async fetchChatListBadges(channelLogin: string): Promise<TwitchBadgeSetShape[]> {
    const response = await this.gql<{ badges?: Array<Record<string, unknown> | null> }>({
      operationName: "ChatList_Badges",
      variables: { channelLogin },
      extensions: {
        persistedQuery: {
          sha256Hash: "dd0997370fb7ca288bc52a96a9a7e3222c75c4a9a9b03df17d779666f07f7529",
          version: 1,
        },
      },
    });
    return flattenedBadges(response.data?.badges ?? []);
  }

  clearCache(): void {
    this.global = null;
    this.channels.clear();
  }
}

export const twitchBadgeCatalogProvider = new TwitchBadgeCatalogProvider();
