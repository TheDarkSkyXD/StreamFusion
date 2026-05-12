import { ipcMain } from "electron";

import type { Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";

/**
 * Helper to validate a channel object has the required fields
 * Filters out deleted/invalid channels from search results
 */
function isValidChannel(channel: any): boolean {
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
const twitchChannelDataCache = new Map<string, { data: any | null; timestamp: number }>();

/**
 * Verify Twitch channels exist and fetch their fresh avatar URLs and follower counts
 * Returns a Map of username -> enriched channel data with fresh avatars and follower counts
 */
async function verifyAndEnrichTwitchChannels(channels: any[]): Promise<Map<string, any>> {
  const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
  const { getFollowerCounts } = await import("../../api/platforms/twitch/endpoints/user-endpoints");

  const enrichedChannels = new Map<string, any>();
  const loginsToFetch: { login: string; originalChannel: any }[] = [];
  const now = Date.now();

  // Check cache first
  for (const channel of channels) {
    const loginLower = channel.username.toLowerCase();
    const cached = twitchChannelDataCache.get(loginLower);

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (cached.data) {
        // Merge cached data (with fresh avatar, display name, and follower count) into the channel
        enrichedChannels.set(loginLower, {
          ...channel,
          avatarUrl: cached.data.profileImageUrl || channel.avatarUrl || "",
          displayName: cached.data.displayName || channel.displayName,
          followerCount: cached.data.followerCount,
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
            const followerCount = followerCounts.get(user.id) ?? 0;

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
            });
          } else {
            // Channel doesn't exist - cache as null
            twitchChannelDataCache.set(loginLower, {
              data: null,
              timestamp: now,
            });
            console.debug(
              `[ChannelVerify] Twitch channel "${login}" does not exist (deleted account)`
            );
          }
        }
      }
    } catch (error) {
      console.warn("[ChannelVerify] Failed to fetch Twitch channels:", error);
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
const kickChannelDataCache = new Map<string, { data: any | null; timestamp: number }>();

/**
 * Verify Kick channels exist and enrich them with avatar/follower data.
 *
 * Authenticated path (fast): one batched `/channels?slug[]=...` call (up to 50 slugs)
 * plus one batched `/users?id[]=...` call for avatars. No BrowserWindow.
 *
 * Unauthenticated path (defer): return inputs unchanged. The hidden-BrowserWindow
 * `getPublicChannel` route serialises behind a global mutex (see
 * channel-endpoints.ts:_browserWindowMutex) which would re-introduce the 10-100s
 * worst case. The frontend lazy-loads avatars on hover/mount, so deferring here
 * only costs us avatars+follower counts in the initial dropdown for logged-out users.
 */
async function verifyAndEnrichKickChannels(channels: any[]): Promise<Map<string, any>> {
  const { kickClient } = await import("../../api/platforms/kick/kick-client");
  const { getChannelsBySlugs } = await import(
    "../../api/platforms/kick/endpoints/channel-endpoints"
  );
  const { getUsersById } = await import("../../api/platforms/kick/endpoints/user-endpoints");

  const enrichedChannels = new Map<string, any>();
  const slugsToFetch: { slug: string; originalChannel: any }[] = [];
  const now = Date.now();

  for (const channel of channels) {
    const slugLower = channel.username.toLowerCase();

    // Skip channels already enriched by upstream search steps (Step 4 top-streams
    // fuzzy match populates avatarUrl + isLive). Saves an API round trip.
    if (channel.avatarUrl && channel.followerCount !== undefined) {
      enrichedChannels.set(slugLower, channel);
      continue;
    }

    const cached = kickChannelDataCache.get(slugLower);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (cached.data) {
        enrichedChannels.set(slugLower, {
          ...channel,
          avatarUrl: cached.data.avatarUrl || channel.avatarUrl || "",
          displayName: cached.data.displayName || channel.displayName,
          isVerified: cached.data.isVerified || channel.isVerified,
          isLive: cached.data.isLive,
          followerCount: cached.data.followerCount,
        });
      }
      // cached.data === null → channel known-deleted, skip.
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

    const userIds = fetched
      .map((c) => parseInt(c.id, 10))
      .filter((id) => !Number.isNaN(id));
    const users = userIds.length > 0 ? await getUsersById(kickClient, userIds) : [];
    const userById = new Map(users.map((u) => [u.user_id.toString(), u]));

    for (const { slug, originalChannel } of slugsToFetch) {
      const slugLower = slug.toLowerCase();
      const fetchedChannel = fetchedBySlug.get(slugLower);

      if (!fetchedChannel) {
        kickChannelDataCache.set(slugLower, { data: null, timestamp: now });
        console.debug(
          `[ChannelVerify] Kick channel "${slug}" does not exist (deleted account)`
        );
        continue;
      }

      const user = userById.get(fetchedChannel.id);
      const avatarUrl = user?.profile_picture || fetchedChannel.avatarUrl || "";
      const displayName = user?.name || fetchedChannel.displayName || originalChannel.displayName;

      const merged = {
        ...originalChannel,
        avatarUrl: avatarUrl || originalChannel.avatarUrl || "",
        displayName,
        isVerified: fetchedChannel.isVerified || originalChannel.isVerified,
        isLive: fetchedChannel.isLive,
        followerCount: fetchedChannel.followerCount,
      };

      kickChannelDataCache.set(slugLower, {
        data: {
          avatarUrl: merged.avatarUrl,
          displayName: merged.displayName,
          isVerified: merged.isVerified,
          isLive: merged.isLive,
          followerCount: merged.followerCount,
        },
        timestamp: now,
      });
      enrichedChannels.set(slugLower, merged);
    }
  } catch (error) {
    console.warn("[ChannelVerify] Failed to fetch Kick channels batch:", error);
    for (const { slug, originalChannel } of slugsToFetch) {
      enrichedChannels.set(slug.toLowerCase(), originalChannel);
    }
  }

  return enrichedChannels;
}

/**
 * Filter channels by verifying they exist via platform APIs
 * Removes deleted/non-existent accounts from results
 * Also enriches channels with fresh avatar URLs from API
 */
async function filterVerifiedChannels(channels: any[], platform: Platform): Promise<any[]> {
  if (channels.length === 0) return [];

  if (platform === "twitch") {
    // For Twitch, we enrich channels with fresh avatar URLs during verification
    const enrichedChannelsMap = await verifyAndEnrichTwitchChannels(channels);
    // Return enriched channels as an array (preserves order of original channels that exist)
    return channels
      .filter((c) => enrichedChannelsMap.has(c.username.toLowerCase()))
      .map((c) => enrichedChannelsMap.get(c.username.toLowerCase()));
  } else if (platform === "kick") {
    // For Kick, we enrich channels with avatar URLs during verification
    const enrichedChannelsMap = await verifyAndEnrichKickChannels(channels);
    // Return enriched channels as an array (preserves order of original channels that exist)
    return channels
      .filter((c) => enrichedChannelsMap.has(c.username.toLowerCase()))
      .map((c) => enrichedChannelsMap.get(c.username.toLowerCase()));
  }

  return channels;
}

export function registerSearchHandlers(): void {
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
        const searchPromises: Promise<{ platform: Platform; data: any[]; cursor?: string }>[] = [];

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
              console.warn("⚠️ Failed to search Twitch channels:", err);
              return { platform: "twitch" as Platform, data: [] };
            })
          );
        }

        // Kick search — only on first page (Kick has no cursor-based pagination)
        if ((!params.platform || params.platform === "kick") && !params.after) {
          searchPromises.push(
            (async () => {
              console.debug(`[SearchHandler] Searching Kick for "${params.query}"`);
              const result = await kickClient.searchChannels(params.query);
              console.debug(`[SearchHandler] Kick returned ${result.data.length} raw results`);

              let channels = result.data.filter(isValidChannel);
              console.debug(`[SearchHandler] Kick after validation: ${channels.length} channels`);

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
                channels = await filterVerifiedChannels(channels, "kick");
              }

              console.debug(`[SearchHandler] Kick final: ${channels.length} channels`);
              return { platform: "kick" as Platform, data: channels };
            })().catch((err) => {
              console.warn("⚠️ Failed to search Kick channels:", err);
              return { platform: "kick" as Platform, data: [] };
            })
          );
        }

        // Execute all searches in parallel
        const results = await Promise.all(searchPromises);

        // Log results per platform
        for (const r of results) {
          console.debug(
            `[SearchHandler] Platform ${r.platform} returned ${r.data.length} channels`
          );
        }

        if (!params.platform) {
          const allChannels = results.flatMap((r) => r.data);
          console.debug(`[SearchHandler] Combined total: ${allChannels.length} channels`);

          // Sort by: Live status first, then relevance (Exact match -> Starts with -> Others)
          allChannels.sort((a, b) => {
            const aName = a.username.toLowerCase();
            const bName = b.username.toLowerCase();
            const aDisplay = a.displayName.toLowerCase();
            const bDisplay = b.displayName.toLowerCase();
            const q = normalizedQuery;

            // 1. Live channels first
            if (a.isLive && !b.isLive) return -1;
            if (!a.isLive && b.isLive) return 1;

            // 2. Exact matches
            const aExact = aName === q || aDisplay === q;
            const bExact = bName === q || bDisplay === q;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            // 3. Starts with query
            const aStarts = aName.startsWith(q) || aDisplay.startsWith(q);
            const bStarts = bName.startsWith(q) || bDisplay.startsWith(q);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;

            return 0;
          });

          const twitchCursor = results.find((r) => r.platform === "twitch")?.cursor;
          console.debug(
            `[SearchHandler] Returning ${allChannels.length} channels (cursor: ${twitchCursor ?? "none"})`
          );
          return { success: true, data: allChannels, cursor: twitchCursor };
        }

        const { platform: _p, ...rest } = results[0];
        return { success: true, ...rest };
      } catch (error) {
        console.error("❌ Failed to search channels:", error);
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
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const kickUser = storageService.getKickUser();
        const twitchUser = storageService.getTwitchUser();
        const normalizedQuery = params.query.toLowerCase().trim();

        const results: {
          channels: any[];
          categories: any[];
          streams: any[];
          videos: any[];
          clips: any[];
        } = {
          channels: [],
          categories: [],
          streams: [],
          videos: [],
          clips: [],
        };

        if (!params.platform || params.platform === "twitch") {
          try {
            const [channelResult, categoryResult] = await Promise.all([
              twitchClient.searchChannels(params.query, {
                first: params.limit || 10,
                liveOnly: false,
              }),
              twitchClient.searchCategories(params.query, { first: params.limit || 10 }),
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
            const verifiedTwitchChannels = await filterVerifiedChannels(validChannels, "twitch");
            results.channels.push(...verifiedTwitchChannels);

            // Add live streams from verified channels
            const liveChannels = verifiedTwitchChannels.filter((c) => c.isLive);
            results.streams.push(...liveChannels.map((c) => ({ ...c, platform: "twitch" })));

            results.categories.push(...categoryResult.data);
          } catch (err) {
            console.warn("⚠️ Failed to search Twitch:", err);
          }
        }

        if (!params.platform || params.platform === "kick") {
          try {
            const searchResult = await kickClient.search(params.query);

            if (searchResult.channels) {
              // Filter out invalid/deleted channels
              let channels = searchResult.channels
                .map((c) => ({ ...c, platform: "kick" }))
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

              // Verify channels exist via Kick API (filters deleted accounts)
              const verifiedKickChannels = await filterVerifiedChannels(channels, "kick");
              results.channels.push(...verifiedKickChannels);
            }

            if (searchResult.streams) {
              let streams = searchResult.streams.map((s) => ({
                ...s,
                platform: "kick",
              }));

              if (kickUser) {
                streams = streams.filter((s) => {
                  const matchesUser = s.channelName.toLowerCase() === kickUser.slug.toLowerCase();
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
                ...searchResult.categories.map((c) => ({ ...c, platform: "kick" }))
              );
            }
          } catch (err) {
            console.warn("⚠️ Failed to search Kick:", err);
          }
        }

        // Sort channels by relevance
        results.channels.sort((a, b) => {
          const aName = a.username.toLowerCase();
          const bName = b.username.toLowerCase();
          const aDisplay = a.displayName.toLowerCase();
          const bDisplay = b.displayName.toLowerCase();
          const q = normalizedQuery;

          const aExact = aName === q || aDisplay === q;
          const bExact = bName === q || bDisplay === q;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;

          const aStarts = aName.startsWith(q) || aDisplay.startsWith(q);
          const bStarts = bName.startsWith(q) || bDisplay.startsWith(q);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;

          return 0;
        });

        return { success: true, data: results };
      } catch (error) {
        console.error("❌ Full search failed:", error);
        return { success: false, error: error instanceof Error ? error.message : "Search failed" };
      }
    }
  );
}
