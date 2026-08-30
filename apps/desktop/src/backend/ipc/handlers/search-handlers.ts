import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@backend/logging/logger";
import { createProgressiveClipSearch } from "@backend/search/progressive-clip-search";
import {
  focusedRecentContentSources,
  focusedStreamSources,
} from "@backend/search/focused-search-sources";
import {
  createProgressiveStreamSearch,
  readStreamSearchFailureProgress,
  STREAM_SEARCH_BUDGET_PROFILES,
} from "@backend/search/progressive-stream-search";
import { createProgressiveVideoSearch } from "@backend/search/progressive-video-search";
import {
  attachSearchSession,
  cancelSearchSession,
  isSearchCancelled,
} from "@backend/search/search-session-manager";
import { rankSearchChannels } from "@/features/discovery/utils/search/channel-search-contract";
import type { SearchResultCollection } from "@/features/discovery/utils/search/search-result-validation";
import type { UnifiedChannel } from "../../../shared/platform-types";
import type { Platform } from "../../../shared/auth-types";
import type {
  SearchStreamsRequest,
  SearchStreamsResponse,
  SearchVideosRequest,
  SearchVideosResponse,
} from "../../../shared/search-types";
import type { DiscoveryProviderCompletion, DiscoveryResult } from "../../../shared/discovery-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";

function failedProviders(platform?: Platform): DiscoveryProviderCompletion {
  return platform ? { [platform]: "failed" } : { twitch: "failed", kick: "failed" };
}

/**
 * Helper to validate a channel object has the required fields
 * Filters out deleted/invalid channels from search results
 */
function isValidChannel(
  channel: UnifiedChannel & { is_banned?: boolean; is_deleted?: boolean }
): boolean {
  // Must have basic identifying info
  if (!channel.id || !channel.username) {
    return false;
  }
  // Skip if explicitly marked as deleted or banned (Kick)
  if (channel.is_banned === true || channel.is_deleted === true) {
    return false;
  }
  return true;
}

// Cache verified channels to avoid repeated API calls (5 minute TTL)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cache for Twitch channel data (includes fresh avatar URLs)
 */
type TwitchChannelCacheData = {
  profileImageUrl: string;
  displayName: string;
  broadcasterType: string;
  followerCount?: number;
};
const twitchChannelDataCache = new Map<
  string,
  { data: TwitchChannelCacheData | null; timestamp: number }
>();

/**
 * Verify Twitch channels exist and fetch their fresh avatar URLs and follower counts
 * Returns a Map of username -> enriched channel data with fresh avatars and follower counts
 */
async function verifyAndEnrichTwitchChannels(
  channels: UnifiedChannel[]
): Promise<Map<string, UnifiedChannel>> {
  const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
  const { getFollowerCounts } = await import("../../api/platforms/twitch/endpoints/user-endpoints");

  const enrichedChannels = new Map<string, UnifiedChannel>();

  // GQL search (used by twitchClient.searchChannels) already returns avatar,
  // displayName, and followerCount for unauthenticated callers. The Helix
  // enrichment path below requires a user token, so calling it without auth
  // throws "Not authenticated with Twitch" for every search keystroke. Short-
  // circuit and pass channels through unchanged when we don't have auth.
  if (!twitchClient.isAuthenticated()) {
    for (const channel of channels) {
      enrichedChannels.set(channel.username.toLowerCase(), channel);
    }
    return enrichedChannels;
  }

  const loginsToFetch: { login: string; originalChannel: UnifiedChannel }[] = [];
  const now = Date.now();

  // Check cache first
  for (const channel of channels) {
    const loginLower = channel.username.toLowerCase();
    const cached = twitchChannelDataCache.get(loginLower);

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (cached.data) {
        const isPartner = cached.data.broadcasterType === "partner" || channel.isPartner;
        // Merge cached data (with fresh avatar, display name, and follower count) into the channel
        enrichedChannels.set(loginLower, {
          ...channel,
          avatarUrl: cached.data.profileImageUrl || channel.avatarUrl || "",
          displayName: cached.data.displayName || channel.displayName,
          followerCount: cached.data.followerCount,
          isPartner,
          isVerified: isPartner || channel.isVerified,
        });
      }
      // If cached.data is null, channel doesn't exist - skip it
    } else {
      loginsToFetch.push({ login: channel.username, originalChannel: channel });
    }
  }

  // Fetch uncached channels via API (batch in groups of 100)
  if (loginsToFetch.length > 0) {
    try {
      // Twitch API supports up to 100 logins per request
      const batchSize = 100;
      for (let i = 0; i < loginsToFetch.length; i += batchSize) {
        const batch = loginsToFetch.slice(i, i + batchSize);
        const logins = batch.map((item) => item.login);
        const users = await twitchClient.getUsersByLogin(logins);

        // Create a map of login -> user data for quick lookup
        const userMap = new Map(users.map((u) => [u.login.toLowerCase(), u]));

        // Fetch follower counts for all users in this batch
        const userIds = users.map((u) => u.id);
        const followerCounts = await getFollowerCounts(twitchClient, userIds);

        for (const { login, originalChannel } of batch) {
          const loginLower = login.toLowerCase();
          const user = userMap.get(loginLower);

          if (user) {
            const followerCount = followerCounts.get(user.id);
            const isPartner = user.broadcasterType === "partner" || originalChannel.isPartner;

            // Cache the fetched user data with follower count
            twitchChannelDataCache.set(loginLower, {
              data: { ...user, followerCount },
              timestamp: now,
            });

            // Merge fetched data (with fresh avatar and follower count) into the original channel
            enrichedChannels.set(loginLower, {
              ...originalChannel,
              avatarUrl: user.profileImageUrl || originalChannel.avatarUrl || "",
              displayName: user.displayName || originalChannel.displayName,
              followerCount,
              isPartner,
              isVerified: isPartner || originalChannel.isVerified,
            });
          } else {
            // Channel doesn't exist - cache as null
            twitchChannelDataCache.set(loginLower, {
              data: null,
              timestamp: now,
            });
            logger.debug("IPC:Search", "Twitch channel does not exist (deleted account)", {
              login,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("IPC:Search", "Failed to fetch Twitch channels", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      // On error, include original channels without enrichment
      for (const { login, originalChannel } of loginsToFetch) {
        enrichedChannels.set(login.toLowerCase(), originalChannel);
      }
    }
  }

  return enrichedChannels;
}

/**
 * Cache for Kick channel data (includes avatar URLs and follower counts)
 */
type KickChannelCacheData = Pick<
  UnifiedChannel,
  "avatarUrl" | "displayName" | "isVerified" | "isPartner" | "isLive" | "followerCount"
>;
const kickChannelDataCache = new Map<string, { data: KickChannelCacheData; timestamp: number }>();

function hasCasedKickDisplayName(channel: UnifiedChannel): boolean {
  const username = typeof channel.username === "string" ? channel.username.trim() : "";
  const displayName = typeof channel.displayName === "string" ? channel.displayName.trim() : "";
  return Boolean(displayName && displayName !== username);
}

/**
 * Verify Kick channels exist and enrich them with avatar/follower data.
 *
 * Authenticated path (fast): one batched `/channels?slug=...&slug=...` call (up to 50 slugs)
 * plus one batched `/users?id[]=...` call for avatars. No BrowserWindow.
 *
 * Unauthenticated path (defer): return inputs unchanged. The hidden-BrowserWindow
 * `getPublicChannel` route serialises behind a global mutex (see
 * channel-endpoints.ts:_browserWindowMutex) which would re-introduce the 10-100s
 * worst case. The frontend lazy-loads avatars on hover/mount, so deferring here
 * only costs us avatars+follower counts in the initial dropdown for logged-out users.
 */
async function verifyAndEnrichKickChannels(
  channels: UnifiedChannel[]
): Promise<Map<string, UnifiedChannel>> {
  const { kickClient } = await import("../../api/platforms/kick/kick-client");
  const { getChannelsBySlugs } =
    await import("../../api/platforms/kick/endpoints/channel-endpoints");

  const enrichedChannels = new Map<string, UnifiedChannel>();
  const slugsToFetch: { slug: string; originalChannel: UnifiedChannel }[] = [];
  const now = Date.now();

  for (const channel of channels) {
    const slugLower = channel.username.toLowerCase();

    // Skip channels already enriched by upstream search steps. Kick's live
    // directory populates avatarUrl + isLive but not followerCount; sending
    // those through the official channel lookup can drop valid live channels
    // when the official batch response is partial.
    if (
      channel.avatarUrl &&
      (channel.followerCount !== undefined || channel.isLive) &&
      hasCasedKickDisplayName(channel)
    ) {
      enrichedChannels.set(slugLower, channel);
      continue;
    }

    const cached = kickChannelDataCache.get(slugLower);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      enrichedChannels.set(slugLower, {
        ...channel,
        avatarUrl: cached.data.avatarUrl || channel.avatarUrl || "",
        displayName: cached.data.displayName || channel.displayName,
        isVerified: cached.data.isVerified || channel.isVerified,
        isPartner: cached.data.isPartner || channel.isPartner,
        isLive: cached.data.isLive,
        followerCount: cached.data.followerCount,
      });
    } else {
      slugsToFetch.push({ slug: channel.username, originalChannel: channel });
    }
  }

  if (slugsToFetch.length === 0) {
    return enrichedChannels;
  }

  // Unauthenticated: pass through. Frontend hover/mount hooks will lazy-load.
  if (!kickClient.isAuthenticated()) {
    for (const { slug, originalChannel } of slugsToFetch) {
      enrichedChannels.set(slug.toLowerCase(), originalChannel);
    }
    return enrichedChannels;
  }

  try {
    const slugs = slugsToFetch.map((item) => item.slug);
    const fetched = await getChannelsBySlugs(kickClient, slugs);
    const fetchedBySlug = new Map(fetched.map((c) => [c.username.toLowerCase(), c]));

    for (const { slug, originalChannel } of slugsToFetch) {
      const slugLower = slug.toLowerCase();
      const fetchedChannel = fetchedBySlug.get(slugLower);

      if (!fetchedChannel) {
        enrichedChannels.set(slugLower, {
          ...originalChannel,
          accountStatus: "unavailable",
        });
        logger.debug("IPC:Search", "Kick channel batch result was ambiguous", { slug });
        continue;
      }

      const merged = {
        ...originalChannel,
        avatarUrl: fetchedChannel.avatarUrl || originalChannel.avatarUrl || "",
        displayName: fetchedChannel.displayName || originalChannel.displayName,
        isVerified: fetchedChannel.isVerified || originalChannel.isVerified,
        isPartner: fetchedChannel.isPartner || originalChannel.isPartner,
        isLive: fetchedChannel.isLive,
        // /public/v1/channels doesn't return follower counts, so prefer whatever
        // the upstream search step (kick.com/api/search) populated.
        followerCount: fetchedChannel.followerCount ?? originalChannel.followerCount,
      };

      kickChannelDataCache.set(slugLower, {
        data: {
          avatarUrl: merged.avatarUrl,
          displayName: merged.displayName,
          isVerified: merged.isVerified,
          isPartner: merged.isPartner,
          isLive: merged.isLive,
          followerCount: merged.followerCount,
        },
        timestamp: now,
      });
      enrichedChannels.set(slugLower, merged);
    }
  } catch (error) {
    logger.warn("IPC:Search", "Failed to fetch Kick channels batch", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    for (const { slug, originalChannel } of slugsToFetch) {
      enrichedChannels.set(slug.toLowerCase(), {
        ...originalChannel,
        accountStatus: originalChannel.accountStatus === "suspended" ? "suspended" : "unavailable",
      });
    }
  }

  return enrichedChannels;
}

/**
 * Enrich channels with fresh platform metadata. Kick candidates remain visible
 * through uncertain lookups and are excluded only after an authoritative exact
 * not-found confirmation.
 */
async function filterVerifiedChannels(
  channels: UnifiedChannel[],
  platform: Platform,
  exactQuery?: string
): Promise<UnifiedChannel[]> {
  if (channels.length === 0) return [];

  if (platform === "twitch") {
    // For Twitch, we enrich channels with fresh avatar URLs during verification
    const enrichedChannelsMap = await verifyAndEnrichTwitchChannels(channels);
    // Return enriched channels as an array (preserves order of original channels that exist)
    return channels.flatMap((channel) => {
      const enriched = enrichedChannelsMap.get(channel.username.toLowerCase());
      return enriched ? [enriched] : [];
    });
  } else if (platform === "kick") {
    // For Kick, we enrich channels with avatar URLs during verification
    const enrichedChannelsMap = await verifyAndEnrichKickChannels(channels);
    // Return enriched channels as an array (preserves order of original channels that exist)
    const enrichedChannels = channels.flatMap((channel) => {
      const enriched = enrichedChannelsMap.get(channel.username.toLowerCase());
      return enriched ? [enriched] : [];
    });

    const { kickClient } = await import("../../api/platforms/kick/kick-client");
    const normalizedExactQuery = exactQuery?.trim().toLowerCase();
    const classifiedChannels = await Promise.all(
      enrichedChannels.map(async (channel) => {
        const classifiedChannel: UnifiedChannel = {
          ...channel,
          accountStatus: channel.accountStatus || "active",
        };
        if (
          classifiedChannel.accountStatus !== "unavailable" ||
          classifiedChannel.username.toLowerCase() !== normalizedExactQuery
        ) {
          return classifiedChannel;
        }

        try {
          const authoritativeStatus = await kickClient.getOfficialChannelAccountStatus(
            classifiedChannel.username
          );
          if (authoritativeStatus === "not_found") return null;
          if (authoritativeStatus === "active") {
            return { ...classifiedChannel, accountStatus: "active" as const };
          }
        } catch (error) {
          logger.debug("IPC:Search", "Exact Kick account lookup was unavailable", {
            username: classifiedChannel.username,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return classifiedChannel;
      })
    );

    return classifiedChannels.filter((channel) => channel !== null);
  }

  return channels;
}

export function registerSearchHandlers(): void {
  const activeBroadSearches = new Map<string, AbortController>();
  const streamSearches = {
    twitch: createProgressiveStreamSearch({
      sources: { twitch: focusedStreamSources.twitch },
      profile: STREAM_SEARCH_BUDGET_PROFILES.twitch,
    }),
    kick: createProgressiveStreamSearch({
      sources: { kick: focusedStreamSources.kick },
      profile: STREAM_SEARCH_BUDGET_PROFILES.kick,
    }),
  };
  const videoSearches = {
    twitch: createProgressiveVideoSearch({
      source: focusedRecentContentSources.twitch.videos,
      profile: { pageSize: 12, maxConcurrentRequests: 3 },
    }),
    kick: createProgressiveVideoSearch({
      source: focusedRecentContentSources.kick.videos,
      profile: { pageSize: 12, maxConcurrentRequests: 3 },
    }),
  };
  const clipSearches = {
    twitch: createProgressiveClipSearch({
      source: focusedRecentContentSources.twitch.clips,
      profile: { pageSize: 12, maxConcurrentRequests: 3 },
    }),
    kick: createProgressiveClipSearch({
      source: focusedRecentContentSources.kick.clips,
      profile: { pageSize: 12, maxConcurrentRequests: 3 },
    }),
  };

  ipcMain.handle(
    IPC_CHANNELS.SEARCH_STREAMS,
    async (_event, params: SearchStreamsRequest): Promise<SearchStreamsResponse> => {
      const session = attachSearchSession(params.sessionId);
      try {
        const page = await streamSearches[params.platform].next({
          ...params,
          signal: session.signal,
        });
        return {
          success: true,
          sessionId: params.sessionId,
          platform: params.platform,
          retryable: page.endReason === "rate-limited",
          error: null,
          ...page,
        };
      } catch (error) {
        const cancelled = isSearchCancelled(error);
        const progress = readStreamSearchFailureProgress(error);
        return {
          success: false,
          sessionId: params.sessionId,
          platform: params.platform,
          data: [],
          endReason: cancelled ? "cancelled" : undefined,
          retryable: !cancelled,
          error: cancelled
            ? null
            : {
                platform: params.platform,
                message: error instanceof Error ? error.message : String(error),
              },
          scannedPages: progress?.scannedPages ?? 0,
          requestCount: progress?.requestCount ?? 0,
        };
      } finally {
        session.release();
      }
    }
  );

  const registerRecentContentHandler = <T>(
    channel: string,
    searches: Record<
      Platform,
      {
        next(request: SearchVideosRequest & { signal: AbortSignal }): Promise<{
          data: T[];
          cursor?: string;
          endReason?: "exhausted" | "safety-limit" | "rate-limited";
          retryAfterMs?: number;
          requestCount: number;
          matchedChannelCount: number;
        }>;
      }
    >
  ) => {
    ipcMain.handle(
      channel,
      async (_event, params: SearchVideosRequest): Promise<SearchVideosResponse<T>> => {
        const session = attachSearchSession(params.sessionId);
        try {
          const page = await searches[params.platform].next({ ...params, signal: session.signal });
          return {
            success: true,
            sessionId: params.sessionId,
            platform: params.platform,
            retryable: page.endReason === "rate-limited",
            error: null,
            ...page,
          };
        } catch (error) {
          const cancelled = isSearchCancelled(error);
          return {
            success: false,
            sessionId: params.sessionId,
            platform: params.platform,
            data: [],
            endReason: cancelled ? "cancelled" : undefined,
            retryable: !cancelled,
            error: cancelled
              ? null
              : {
                  platform: params.platform,
                  message: error instanceof Error ? error.message : String(error),
                },
            requestCount: 0,
            matchedChannelCount: 0,
          };
        } finally {
          session.release();
        }
      }
    );
  };

  registerRecentContentHandler(IPC_CHANNELS.SEARCH_VIDEOS, videoSearches);
  registerRecentContentHandler(IPC_CHANNELS.SEARCH_CLIPS, clipSearches);

  ipcMain.handle(IPC_CHANNELS.SEARCH_CANCEL, async (_event, params: { requestId: string }) => {
    const controller = activeBroadSearches.get(params.requestId);
    controller?.abort(new DOMException("Stale search request", "AbortError"));
    const progressiveCancelled = cancelSearchSession(params.requestId);
    for (const search of Object.values(streamSearches)) search.clear(params.requestId);
    for (const search of Object.values(videoSearches)) search.clear(params.requestId);
    for (const search of Object.values(clipSearches)) search.clear(params.requestId);
    return { success: true, cancelled: controller !== undefined || progressiveCancelled };
  });

  /**
   * Search channels across platforms
   */
  ipcMain.handle(
    IPC_CHANNELS.SEARCH_CHANNELS,
    async (
      _event,
      params: {
        query: string;
        platform?: Platform;
        liveOnly?: boolean;
        limit?: number;
        after?: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const kickUser = storageService.getKickUser();
        const twitchUser = storageService.getTwitchUser();
        const normalizedQuery = params.query.toLowerCase().trim();
        // Always enrich channels to get avatars and follower counts
        // The enrichment is cached so repeated searches are fast
        const shouldEnrich = true;

        // Create search promises for parallel execution
        const searchPromises: Promise<{
          platform: Platform;
          data: UnifiedChannel[];
          cursor?: string;
        }>[] = [];

        // Twitch search
        if (!params.platform || params.platform === "twitch") {
          searchPromises.push(
            (async () => {
              const result = await twitchClient.searchChannels(params.query, {
                first: params.limit || 50,
                after: params.after,
                liveOnly: params.liveOnly,
              });

              let channels = result.data.filter(isValidChannel);
              if (twitchUser) {
                channels = channels.filter((c) => {
                  const matchesUser = c.username.toLowerCase() === twitchUser.login.toLowerCase();
                  if (matchesUser) {
                    return normalizedQuery === twitchUser.login.toLowerCase();
                  }
                  return true;
                });
              }

              // Always enrich to get avatars and follower counts
              if (shouldEnrich) {
                channels = await filterVerifiedChannels(channels, "twitch");
              }

              return { platform: "twitch" as Platform, data: channels, cursor: result.cursor };
            })().catch((err) => {
              logger.warn("IPC:Search", "Failed to search Twitch channels", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
              return { platform: "twitch" as Platform, data: [] };
            })
          );
        }

        // Kick search. Combined cross-platform pagination keeps using Twitch's
        // cursor because the platforms cannot share a cursor, but Kick-only
        // result pages can continue through Kick's live-channel scan.
        const shouldSearchKick = params.platform === "kick" || (!params.platform && !params.after);
        if (shouldSearchKick) {
          searchPromises.push(
            (async () => {
              logger.debug("IPC:Search", "Searching Kick", {
                query: params.query,
                after: params.after,
              });
              const result = await kickClient.searchChannels(params.query, {
                limit: params.limit || 50,
                cursor: params.after,
                liveOnly: params.liveOnly,
              });
              logger.debug("IPC:Search", "Kick returned raw results", {
                count: result.data.length,
                cursor: result.cursor,
              });

              let channels = result.data.filter(isValidChannel);
              logger.debug("IPC:Search", "Kick channels after validation", {
                count: channels.length,
              });

              if (kickUser) {
                channels = channels.filter((c) => {
                  const matchesUser = c.username.toLowerCase() === kickUser.slug.toLowerCase();
                  if (matchesUser) {
                    return normalizedQuery === kickUser.slug.toLowerCase();
                  }
                  return true;
                });
              }

              // Always enrich to get avatars and follower counts
              if (shouldEnrich) {
                channels = await filterVerifiedChannels(channels, "kick", normalizedQuery);
              }

              logger.debug("IPC:Search", "Kick final channels", {
                count: channels.length,
                cursor: result.cursor,
              });
              return { platform: "kick" as Platform, data: channels, cursor: result.cursor };
            })().catch((err) => {
              logger.warn("IPC:Search", "Failed to search Kick channels", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
              return { platform: "kick" as Platform, data: [] };
            })
          );
        }

        // Execute all searches in parallel
        const results = await Promise.all(searchPromises);

        // Log results per platform
        for (const r of results) {
          logger.debug("IPC:Search", "Platform returned channels", {
            platform: r.platform,
            count: r.data.length,
          });
        }

        if (!params.platform) {
          const allChannels = rankSearchChannels(
            results.flatMap((r) => r.data),
            params.query
          );
          logger.debug("IPC:Search", "Combined total channels", {
            count: allChannels.length,
          });

          const twitchCursor = results.find((r) => r.platform === "twitch")?.cursor;
          logger.debug("IPC:Search", "Returning channels", {
            count: allChannels.length,
            cursor: twitchCursor ?? null,
          });
          return { success: true, data: allChannels, cursor: twitchCursor };
        }

        const { platform: _p, ...rest } = results[0];
        return {
          success: true,
          ...rest,
          data: rankSearchChannels(rest.data, params.query),
        };
      } catch (error) {
        logger.error("IPC:Search", "Failed to search channels", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : "Search failed" };
      }
    }
  );

  /**
   * Full search across all content types
   */
  ipcMain.handle(
    IPC_CHANNELS.SEARCH_ALL,
    async (
      _event,
      params: {
        query: string;
        platform?: Platform;
        limit?: number;
        channelSeeds?: UnifiedChannel[];
        channelSeedPlatforms?: Platform[];
        requestId?: string;
      }
    ): Promise<DiscoveryResult<SearchResultCollection>> => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      const controller = new AbortController();
      if (params.requestId) {
        activeBroadSearches.set(params.requestId, controller);
      }

      try {
        const kickUser = storageService.getKickUser();
        const twitchUser = storageService.getTwitchUser();
        const normalizedQuery = params.query.toLowerCase().trim();
        const channelFirstOnly = normalizedQuery.length === 1;
        const twitchChannelSeeds = (params.channelSeeds ?? []).filter(
          (channel) => channel.platform === "twitch"
        );
        const kickChannelSeeds = (params.channelSeeds ?? []).filter(
          (channel) => channel.platform === "kick"
        );
        const twitchChannelsSeeded =
          twitchChannelSeeds.length > 0 ||
          (params.channelSeedPlatforms?.includes("twitch") ?? false);
        const kickChannelsSeeded =
          kickChannelSeeds.length > 0 || (params.channelSeedPlatforms?.includes("kick") ?? false);

        const results: SearchResultCollection = {
          channels: [],
          categories: [],
          streams: [],
          videos: [],
          clips: [],
        };
        const providers: Partial<Record<Platform, "complete" | "failed">> = {};
        const searchTasks: Promise<void>[] = [];

        if (!params.platform || params.platform === "twitch") {
          searchTasks.push(
            (async () => {
              try {
                const channelSearch = twitchChannelsSeeded
                  ? Promise.resolve({ data: twitchChannelSeeds })
                  : twitchClient.searchChannels(params.query, {
                      first: params.limit || 10,
                      liveOnly: false,
                    });
                const categorySearch = channelFirstOnly
                  ? Promise.resolve({ data: [] })
                  : twitchClient.searchCategories(params.query, { first: params.limit || 10 });
                const [channelResult, categoryResult] = await Promise.all([
                  channelSearch,
                  categorySearch,
                ]);

                // Filter channels - validate and remove invalid/own accounts
                let validChannels = channelResult.data.filter(isValidChannel);
                if (twitchUser) {
                  validChannels = validChannels.filter((c) => {
                    const matchesUser = c.username.toLowerCase() === twitchUser.login.toLowerCase();
                    if (matchesUser) {
                      return normalizedQuery === twitchUser.login.toLowerCase();
                    }
                    return true;
                  });
                }

                // Verify channels exist via Twitch API (filters deleted accounts)
                const verifiedTwitchChannels = twitchChannelsSeeded
                  ? validChannels
                  : await filterVerifiedChannels(validChannels, "twitch");
                results.channels.push(...verifiedTwitchChannels);

                results.categories.push(...categoryResult.data);
                providers.twitch = "complete";
              } catch (err) {
                providers.twitch = "failed";
                logger.warn("IPC:Search", "Failed to search Twitch", {
                  error:
                    err instanceof Error
                      ? { name: err.name, message: err.message, stack: err.stack }
                      : String(err),
                });
              }
            })()
          );
        }

        if (!params.platform || params.platform === "kick") {
          searchTasks.push(
            (async () => {
              try {
                if (channelFirstOnly) {
                  const channelResult = kickChannelsSeeded
                    ? { data: kickChannelSeeds }
                    : await kickClient.searchChannels(params.query);
                  let channels: UnifiedChannel[] = channelResult.data
                    .map((c): UnifiedChannel => ({ ...c, platform: "kick" }))
                    .filter(isValidChannel);

                  if (kickUser) {
                    channels = channels.filter((c) => {
                      const matchesUser = c.username.toLowerCase() === kickUser.slug.toLowerCase();
                      if (matchesUser) {
                        return normalizedQuery === kickUser.slug.toLowerCase();
                      }
                      return true;
                    });
                  }

                  const verifiedKickChannels = kickChannelsSeeded
                    ? channels
                    : await filterVerifiedChannels(channels, "kick", normalizedQuery);
                  results.channels.push(...verifiedKickChannels);
                  providers.kick = "complete";
                  return;
                }

                const searchResult = await kickClient.search(params.query, {
                  channelSeeds: kickChannelsSeeded ? kickChannelSeeds : undefined,
                  signal: controller.signal,
                });

                if (searchResult.channels) {
                  // Filter out invalid/deleted channels
                  let channels: UnifiedChannel[] = searchResult.channels
                    .map((c): UnifiedChannel => ({ ...c, platform: "kick" }))
                    .filter(isValidChannel);

                  if (kickUser) {
                    channels = channels.filter((c) => {
                      const matchesUser = c.username.toLowerCase() === kickUser.slug.toLowerCase();
                      if (matchesUser) {
                        return normalizedQuery === kickUser.slug.toLowerCase();
                      }
                      return true;
                    });
                  }

                  // Enrich Kick channels; exact not-found is the only deletion signal.
                  const verifiedKickChannels = kickChannelsSeeded
                    ? channels
                    : await filterVerifiedChannels(channels, "kick", normalizedQuery);
                  results.channels.push(...verifiedKickChannels);
                }

                if (searchResult.streams) {
                  let streams = searchResult.streams.map((s) => ({
                    ...s,
                    platform: "kick" as const,
                  }));

                  if (kickUser) {
                    streams = streams.filter((s) => {
                      const matchesUser =
                        s.channelName.toLowerCase() === kickUser.slug.toLowerCase();
                      if (matchesUser) {
                        return normalizedQuery === kickUser.slug.toLowerCase();
                      }
                      return true;
                    });
                  }
                  results.streams.push(...streams);
                }

                if (searchResult.categories) {
                  results.categories.push(
                    ...searchResult.categories.map((c) => ({ ...c, platform: "kick" as const }))
                  );
                }
                providers.kick = "complete";
              } catch (err) {
                providers.kick = "failed";
                logger.warn("IPC:Search", "Failed to search Kick", {
                  error:
                    err instanceof Error
                      ? { name: err.name, message: err.message, stack: err.stack }
                      : String(err),
                });
              }
            })()
          );
        }

        await Promise.all(searchTasks);

        results.channels = rankSearchChannels(results.channels, params.query);

        return { success: true, data: results, providers };
      } catch (error) {
        logger.error("IPC:Search", "Full search failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Search failed",
          providers: failedProviders(params.platform),
        };
      } finally {
        if (params.requestId && activeBroadSearches.get(params.requestId) === controller) {
          activeBroadSearches.delete(params.requestId);
        }
      }
    }
  );
}
