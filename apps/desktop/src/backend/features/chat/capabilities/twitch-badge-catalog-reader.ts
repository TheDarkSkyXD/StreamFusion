import type { TwitchBadgeCatalog } from "@shared/chat-types";

export interface TwitchBadgeCatalogReader {
  loadBadgeCatalog(
    broadcasterId: string,
    channelLogin: string,
    credentials: { accessToken: string; clientId: string },
    options?: { forceRefresh?: boolean }
  ): Promise<TwitchBadgeCatalog | null>;
}
