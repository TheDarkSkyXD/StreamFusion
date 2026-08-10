import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import { badgeResolver } from "@/backend/services/chat/badge-resolver";
import { storageService } from "@/backend/services/storage-service";
import { TWITCH_APP_CLIENT_ID } from "@/shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";

interface MentionUserLookup {
  userId?: string;
  username: string;
}

interface MentionUserEnrichment {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const TWITCH_GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const TWITCH_PIN_REQUEST_TIMEOUT_MS = 8_000;

const mentionUserCache = new Map<string, { user: MentionUserEnrichment; expiresAt: number }>();
const MENTION_USER_CACHE_TTL_MS = 15 * 60 * 1000;

function getKickDefaultMentionAvatarUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="24" fill="#53FC18"/><circle cx="24" cy="18" r="8" fill="#101510"/><path d="M10 41c2.4-9 7.2-13 14-13s11.6 4 14 13" fill="#101510"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getKickMentionAvatarUrl(avatarUrl?: string | null): string {
  return avatarUrl || getKickDefaultMentionAvatarUrl();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function uniqueMentionUsers(users: MentionUserLookup[]): MentionUserLookup[] {
  const seen = new Set<string>();
  const unique: MentionUserLookup[] = [];
  for (const user of users) {
    const username = user.username.trim();
    if (!username) continue;
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ userId: user.userId, username });
  }
  return unique;
}

function getCachedMentionUser(
  platform: "twitch" | "kick",
  username: string
): MentionUserEnrichment | null {
  const key = `${platform}:${username.toLowerCase()}`;
  const cached = mentionUserCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    mentionUserCache.delete(key);
    return null;
  }
  return cached.user;
}

function setCachedMentionUser(platform: "twitch" | "kick", user: MentionUserEnrichment): void {
  mentionUserCache.set(`${platform}:${user.username.toLowerCase()}`, {
    user,
    expiresAt: Date.now() + MENTION_USER_CACHE_TTL_MS,
  });
}

async function fetchTwitchPinnedMessage(channel: string): Promise<unknown | null> {
  const login = channel.trim().toLowerCase();
  if (!login) return null;

  const res = await fetch(TWITCH_GQL_ENDPOINT, {
    method: "POST",
    headers: { "Client-Id": TWITCH_GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "PinnedMessagesByChannel",
      variables: { login },
      query: `query PinnedMessagesByChannel($login: String!) {
        channel(name: $login) {
          pinnedChatMessages {
            edges {
              node {
                id
                type
                updatedAt
                startsAt
                endsAt
                pinnedBy {
                  id
                  login
                  displayName
                  chatColor
                  displayBadges(channelLogin: $login) { setID version title imageURL }
                }
                pinnedMessage {
                  id
                  sentAt
                  sender {
                    id
                    login
                    displayName
                    chatColor
                    displayBadges(channelLogin: $login) { setID version title imageURL }
                  }
                  content {
                    text
                    fragments {
                      text
                      content { __typename ... on Emote { id token assetType } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    }),
    signal: AbortSignal.timeout(TWITCH_PIN_REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`gql PinnedMessagesByChannel ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      channel?: { pinnedChatMessages?: { edges?: Array<{ node?: unknown }> } } | null;
    };
    errors?: unknown;
  };
  if (json.errors) throw new Error("gql PinnedMessagesByChannel errors");
  return json.data?.channel?.pinnedChatMessages?.edges?.[0]?.node ?? null;
}

export function registerChatHandlers(): void {
  /**
   * Fetch recent chat history for a Kick channel. The renderer uses this
   * on join to seed the chat with messages that landed before we connected,
   * matching the official site's behaviour.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_GET_KICK_HISTORY,
    async (_event, params: { channelId: string; channelSlug: string }) => {
      try {
        const { getKickChannelHistory } = await import(
          "../../api/platforms/kick/endpoints/chat-endpoints"
        );
        const history = await getKickChannelHistory(params.channelId, params.channelSlug);
        return { success: true, data: history };
      } catch (error) {
        logger.error("IPC:Chat", "getKickChannelHistory failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch Kick chat history",
        };
      }
    }
  );

  /**
   * Fetch raw IRC history for a Twitch channel from recent-messages.robotty.de.
   * Used the same way as the Kick handler — seeds the chat with prior context
   * on join. No auth, no Cloudflare guard; just a plain Electron `net` GET.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY,
    async (_event, params: { channel: string }) => {
      try {
        const { getTwitchChannelHistory } = await import(
          "../../api/platforms/twitch/endpoints/chat-endpoints"
        );
        const history = await getTwitchChannelHistory(params.channel);
        return { success: true, data: history };
      } catch (error) {
        logger.error("IPC:Chat", "getTwitchChannelHistory failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch Twitch chat history",
        };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG, async (_event, params: unknown) => {
    if (
      !params ||
      typeof params !== "object" ||
      !("broadcasterId" in params) ||
      typeof params.broadcasterId !== "string" ||
      !("channelLogin" in params) ||
      typeof params.channelLogin !== "string"
    ) {
      return { success: false, error: "Invalid Twitch badge catalog request" };
    }
    const broadcasterId = params.broadcasterId.trim();
    const channelLogin = params.channelLogin.trim().toLowerCase();
    if (!/^\d+$/.test(broadcasterId) || !/^[a-z0-9_]{1,25}$/.test(channelLogin)) {
      return { success: false, error: "Invalid Twitch badge catalog request" };
    }

    try {
      const userToken = storageService.isTokenExpired("twitch")
        ? null
        : storageService.getToken("twitch");
      const appToken = storageService.isAppTokenExpired("twitch")
        ? null
        : storageService.getAppToken("twitch");
      const accessToken = userToken?.accessToken || appToken?.accessToken || "";
      const catalog = await badgeResolver.loadBadgeCatalog(
        broadcasterId,
        channelLogin,
        accessToken,
        TWITCH_APP_CLIENT_ID,
        {
          forceRefresh:
            "forceRefresh" in params && typeof params.forceRefresh === "boolean"
              ? params.forceRefresh
              : false,
        }
      );
      return catalog
        ? { success: true, data: catalog }
        : { success: false, error: "Could not load Twitch badge catalog" };
    } catch (error) {
      logger.error("IPC:Chat", "getTwitchBadgeCatalog failed", {
        broadcasterId,
        channelLogin,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return { success: false, error: "Could not load Twitch badge catalog" };
    }
  });

  /**
   * Fetch Twitch's current pinned chat message in the main process. Chromium
   * DevTools logs failed renderer fetches even when caught, so this keeps
   * transient DNS/Twitch outages out of the user's console.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE,
    async (_event, params: { channel: string }) => {
      try {
        const pin = await fetchTwitchPinnedMessage(params.channel);
        return { success: true, data: pin };
      } catch (error) {
        logger.debug("IPC:Chat", "getTwitchPinnedMessage failed", {
          channel: params.channel,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch Twitch pinned message",
        };
      }
    }
  );

  /**
   * Enrich known mention candidates with profile metadata. This does not try
   * to enumerate passive viewers; it only looks up users the renderer already
   * knows from chat history/live chat.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS,
    async (
      _event,
      params: { platform: "twitch" | "kick"; channel?: string; users: MentionUserLookup[] }
    ): Promise<
      { success: true; data: MentionUserEnrichment[] } | { success: false; error: string }
    > => {
      try {
        const users = uniqueMentionUsers(params.users).slice(0, 25);
        if (users.length === 0) return { success: true, data: [] };

        const cachedData: MentionUserEnrichment[] = [];
        const usersToFetch: MentionUserLookup[] = [];
        for (const user of users) {
          const cached = getCachedMentionUser(params.platform, user.username);
          if (cached) {
            cachedData.push(cached);
          } else {
            usersToFetch.push(user);
          }
        }
        if (usersToFetch.length === 0) return { success: true, data: cachedData };

        if (params.platform === "twitch") {
          const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
          const data: MentionUserEnrichment[] = [...cachedData];
          const found = new Set<string>();

          try {
            for (const batch of chunk(usersToFetch, 100)) {
              const fetched = await twitchClient.getUsersByLogin(
                batch.map((user) => user.username)
              );
              for (const user of fetched) {
                const enriched = {
                  userId: user.id,
                  username: user.login,
                  displayName: user.displayName || user.login,
                  avatarUrl: user.profileImageUrl || undefined,
                };
                data.push(enriched);
                found.add(user.login.toLowerCase());
                setCachedMentionUser("twitch", enriched);
              }
            }
          } catch (error) {
            logger.debug("IPC:Chat", "Twitch Helix mention enrichment failed; using GQL fallback", {
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : String(error),
            });
          }

          for (const user of usersToFetch) {
            if (found.has(user.username.toLowerCase())) continue;
            try {
              const channel = await twitchClient.getChannelByLogin(user.username);
              if (!channel) continue;
              const enriched = {
                userId: channel.id,
                username: channel.username,
                displayName: channel.displayName || channel.username,
                avatarUrl: channel.avatarUrl || undefined,
              };
              data.push(enriched);
              setCachedMentionUser("twitch", enriched);
            } catch (error) {
              logger.debug("IPC:Chat", "Twitch GQL mention enrichment failed", {
                username: user.username,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
              });
            }
          }

          return { success: true, data };
        }

        const { kickClient } = await import("../../api/platforms/kick/kick-client");
        const data: MentionUserEnrichment[] = [...cachedData];
        const found = new Set<string>();
        const ids = usersToFetch
          .map((user) => Number(user.userId))
          .filter((id) => Number.isInteger(id) && id > 0);

        if (ids.length > 0) {
          const usernameById = new Map(
            usersToFetch
              .filter((user) => user.userId)
              .map((user) => [String(user.userId), user.username] as const)
          );
          try {
            for (const batch of chunk(ids, 100)) {
              const fetched = await kickClient.getUsersById(batch);
              for (const user of fetched) {
                const enriched = {
                  userId: String(user.user_id),
                  username: usernameById.get(String(user.user_id)) ?? user.name,
                  displayName: user.name,
                  avatarUrl: getKickMentionAvatarUrl(user.profile_picture),
                };
                data.push(enriched);
                found.add(enriched.username.toLowerCase());
                setCachedMentionUser("kick", enriched);
              }
            }
          } catch (error) {
            logger.debug(
              "IPC:Chat",
              "Kick official mention enrichment failed; using public fallback",
              {
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
              }
            );
          }
        }

        const channelSlug = params.channel?.trim();
        if (channelSlug) {
          for (const user of usersToFetch) {
            if (found.has(user.username.toLowerCase())) continue;
            try {
              const profile = await kickClient.getPublicChannelUserProfile(
                channelSlug,
                user.username
              );
              if (!profile) continue;
              const enriched = {
                userId: profile.userId || user.userId || user.username,
                username: user.username,
                displayName: profile.displayName || user.username,
                avatarUrl: getKickMentionAvatarUrl(profile.avatarUrl),
              };
              data.push(enriched);
              found.add(user.username.toLowerCase());
              setCachedMentionUser("kick", enriched);
            } catch (error) {
              logger.debug("IPC:Chat", "Kick channel-user mention enrichment failed", {
                channel: channelSlug,
                username: user.username,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
              });
            }
          }
        }

        for (const user of usersToFetch) {
          if (found.has(user.username.toLowerCase())) continue;
          try {
            const channel = await kickClient.getPublicChannel(user.username);
            if (!channel?.avatarUrl) continue;
            const enriched = {
              userId: channel.id || user.userId || user.username,
              username: user.username,
              displayName: channel.displayName || user.username,
              avatarUrl: getKickMentionAvatarUrl(channel.avatarUrl),
            };
            data.push(enriched);
            found.add(user.username.toLowerCase());
            setCachedMentionUser("kick", enriched);
          } catch (error) {
            logger.debug("IPC:Chat", "Kick public mention enrichment failed", {
              username: user.username,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : String(error),
            });
          }
        }

        for (const user of usersToFetch) {
          if (found.has(user.username.toLowerCase())) continue;
          const enriched = {
            userId: user.userId || user.username,
            username: user.username,
            displayName: user.username,
            avatarUrl: getKickDefaultMentionAvatarUrl(),
          };
          data.push(enriched);
          setCachedMentionUser("kick", enriched);
        }

        return { success: true, data };
      } catch (error) {
        logger.warn("IPC:Chat", "mention user enrichment failed", {
          platform: params.platform,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to enrich mention users",
        };
      }
    }
  );
}
