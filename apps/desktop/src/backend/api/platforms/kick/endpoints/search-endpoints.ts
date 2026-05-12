import type { UnifiedChannel, UnifiedStream } from "../../../unified/platform-types";
import type { KickRequestor } from "../kick-requestor";
import type { PaginatedResult, PaginationOptions } from "../kick-types";

import { searchCategories } from "./category-endpoints";
import { getChannel, getPublicChannel } from "./channel-endpoints";
import { getStreamBySlug, getTopStreamsCached } from "./stream-endpoints";

/**
 * Search for channels (using categories search + livestreams)
 * Note: Official API doesn't have a direct channel search endpoint
 */
export async function searchChannels(
  client: KickRequestor,
  query: string,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  // Kick official API doesn't support fuzzy channel search.
  // Strategy:
  // 1. Exact match: Try to find a channel by exact slug using Public API.
  // 2. Public Search: Use unofficial search endpoint (fuzzy & offline).
  // 3. Official Exact match: Try via authenticated API (redundancy).
  // 4. Fuzzy match (Live): Fetch top streams and filter by slug/name (Official API).

  // IMPORTANT: Deduplicate by username (slug), not ID, since different API endpoints
  // return different ID formats for the same channel.
  const results = new Map<string, UnifiedChannel>();
  const normalizedQuery = query.toLowerCase().trim();

  // Helper to merge channel data - prefer entries with more complete data
  // Priority: Step 1/3 (exact match) > Step 2 (search API) > Step 4 (top streams)
  // The channel's actual live status comes from Step 1/3 which check the livestream field
  const mergeChannel = (
    existing: UnifiedChannel | undefined,
    newChannel: UnifiedChannel,
    isAuthoritativeSource: boolean = false
  ): UnifiedChannel => {
    if (!existing) return newChannel;

    // Prefer the entry with an avatar
    const hasAvatar = (c: UnifiedChannel) => !!c.avatarUrl && c.avatarUrl.length > 0;

    // For live status:
    // - If new source is authoritative (Steps 1, 3), use its live status
    // - Otherwise, keep existing live status (don't let Step 4 override with isLive: true)
    const isLive = isAuthoritativeSource ? newChannel.isLive : existing.isLive;

    // Always prefer the entry with an avatar, but keep the authoritative live status
    if (hasAvatar(newChannel) && !hasAvatar(existing)) {
      return { ...newChannel, isLive };
    }
    // If existing has avatar but new doesn't, keep existing but merge avatar if new has one
    if (hasAvatar(existing)) {
      return { ...existing, isLive };
    }
    // Neither has avatar, keep existing with merged data
    return { ...existing, isLive, avatarUrl: newChannel.avatarUrl || existing.avatarUrl };
  };

  // 1. Try exact slug match (Public API - No Auth)
  try {
    console.debug(`[KickSearch] Step 1: Checking exact slug match for "${normalizedQuery}"`);
    const channel = await getPublicChannel(normalizedQuery);
    if (channel) {
      console.debug(`[KickSearch] Step 1: Found channel "${channel.username}"`);
      const key = channel.username.toLowerCase();
      results.set(key, mergeChannel(results.get(key), channel, true)); // Step 1 is authoritative for live status
    } else {
      console.debug(`[KickSearch] Step 1: No channel found for "${normalizedQuery}"`);
    }
  } catch (e) {
    console.warn(`[KickSearch] Step 1: Error fetching public channel "${normalizedQuery}"`, e);
  }

  // 2. Try public search endpoint (Unofficial - Works for offline & fuzzy)
  // For short queries (1-2 chars), try multiple endpoints since main one returns 400
  // Endpoint options:
  // - https://kick.com/api/search?searched_word=query (main, needs 3+ chars)
  // - https://kick.com/api/search/channel?searched_word=query (might work for short)
  try {
    console.debug(`[KickSearch] Step 2: Querying public search endpoint for "${normalizedQuery}"`);

    // Try alternative endpoint first for short queries
    const searchEndpoints =
      normalizedQuery.length < 3
        ? [
            `https://kick.com/api/search/channel?searched_word=${encodeURIComponent(normalizedQuery)}`,
            `https://kick.com/api/v1/search?q=${encodeURIComponent(normalizedQuery)}`,
            `https://kick.com/api/search?searched_word=${encodeURIComponent(normalizedQuery)}`,
          ]
        : [`https://kick.com/api/search?searched_word=${encodeURIComponent(normalizedQuery)}`];

    let data: any = null;

    for (const searchUrl of searchEndpoints) {
      if (data) break; // Found results, stop trying

      try {
        data = await new Promise<any>((resolve, _reject) => {
          const { net } = require("electron");
          const request = net.request({
            method: "GET",
            url: searchUrl,
          });

          request.setHeader("Accept", "application/json");
          request.setHeader(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          );
          request.setHeader("Referer", "https://kick.com/");
          request.setHeader("Origin", "https://kick.com");
          request.setHeader("X-Requested-With", "XMLHttpRequest");

          // Set a timeout for short queries
          const timeout = setTimeout(() => {
            request.abort();
            resolve(null);
          }, 1500);

          request.on("response", (response: any) => {
            let body = "";
            response.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            response.on("end", () => {
              clearTimeout(timeout);
              if (response.statusCode === 200) {
                try {
                  const parsed = JSON.parse(body);
                  if (parsed && (Array.isArray(parsed) || parsed.channels || parsed.data)) {
                    console.debug(`[KickSearch] Step 2: Got results from ${searchUrl}`);
                    resolve(parsed);
                  } else {
                    resolve(null);
                  }
                } catch (_e) {
                  // Common case: 200 OK but body is cloudflare HTML
                  if (body.trim().startsWith("<")) {
                    console.warn(
                      `[KickSearch] Step 2: Endpoint returned HTML (likely bot protection)`
                    );
                  }
                  resolve(null);
                }
              } else {
                // Try next endpoint on 4xx errors
                if (response.statusCode >= 400 && response.statusCode < 500) {
                  console.debug(
                    `[KickSearch] Step 2: ${searchUrl} returned ${response.statusCode}, trying next...`
                  );
                }
                resolve(null);
              }
            });
          });

          request.on("error", (_error: Error) => {
            clearTimeout(timeout);
            console.debug(`[KickSearch] Step 2: ${searchUrl} error, trying next...`);
            resolve(null);
          });

          request.end();
        });
      } catch (_e) {
        // Continue to next endpoint
      }
    }

    if (!data) {
      console.debug(`[KickSearch] Step 2: No results from any search endpoint`);
    }

    // Handle different response formats:
    // - Direct array of results
    // - Object with 'channels' array
    // - Object with 'data' array
    let channelsArray: any[] = [];
    if (data) {
      if (Array.isArray(data)) {
        channelsArray = data;
      } else if (data.channels && Array.isArray(data.channels)) {
        channelsArray = data.channels;
      } else if (data.data && Array.isArray(data.data)) {
        channelsArray = data.data;
      } else {
        console.debug(`[KickSearch] Step 2: Unknown response structure, keys:`, Object.keys(data));
      }
    }

    if (channelsArray.length > 0) {
      console.debug(`[KickSearch] Step 2: Found ${channelsArray.length} results`);

      for (const item of channelsArray) {
        // Try different possible ID and slug fields
        const channelId = (item.id || item.user_id || item.channel_id)?.toString();
        const channelSlug = item.slug || item.channel_slug || item.username;

        // Skip banned accounts - they shouldn't appear in search results
        if (item.is_banned === true) {
          console.debug(`[KickSearch] Step 2: Skipping banned channel "${channelSlug}"`);
          continue;
        }

        // The user object may contain the profile picture
        const userObj = item.user || {};

        // Try multiple possible avatar field names - Kick uses various formats
        const avatarUrl =
          item.profile_pic ||
          item.profile_picture ||
          item.profilePic ||
          item.avatar ||
          userObj.profile_pic ||
          userObj.profile_picture ||
          userObj.profilePic ||
          userObj.profile_image ||
          userObj.avatar ||
          item.thumbnail?.url ||
          item.thumbnail_url ||
          "";

        if (channelSlug) {
          const key = channelSlug.toLowerCase();
          const newChannel: UnifiedChannel = {
            id: channelId || `kick-${channelSlug}`,
            platform: "kick",
            username: channelSlug,
            displayName:
              item.username || userObj.username || userObj.name || item.display_name || channelSlug,
            avatarUrl,
            bannerUrl: "",
            bio: "",
            // Set isLive to false for search API results (stale data)
            // Only authoritative sources (Step 1 getPublicChannel, Step 4 top streams) set true
            isLive: false,
            isVerified: item.verified || item.is_verified || false,
            isPartner: false,
          };

          // Note: The Kick search API doesn't include avatars - they're only available
          // from direct channel lookups (Step 1 and Step 3). For channels without an
          // exact slug match, the UI will show a letter fallback.

          results.set(key, mergeChannel(results.get(key), newChannel, false)); // Step 2 is NOT authoritative
        }
      }
    }
  } catch (e) {
    console.warn(`[KickSearch] Step 2: Error querying public search endpoint`, e);
  }

  // 3. Try official exact slug match (Official API - Requires Auth)
  if (client.isAuthenticated()) {
    try {
      console.debug(`[KickSearch] Step 3: Checking official API for "${normalizedQuery}"`);
      const channel = await getChannel(client, normalizedQuery);
      if (channel) {
        console.debug(`[KickSearch] Step 3: Found channel "${channel.username}"`);
        const key = channel.username.toLowerCase();
        results.set(key, mergeChannel(results.get(key), channel, true)); // Step 3 is authoritative for live status
      }
    } catch (e) {
      console.warn(`[KickSearch] Step 3: Error fetching official channel "${normalizedQuery}"`, e);
    }
  }

  // 4. Try to get fuzzy matches from Top Streams
  // This helps find live channels even if the query is partial or fuzzy.
  try {
    console.debug(`[KickSearch] Step 4: Checking top streams for fuzzy match`);
    const topStreams = await getTopStreamsCached(client);
    console.debug(`[KickSearch] Step 4: Found ${topStreams.length} top streams to filter`);

    for (const stream of topStreams) {
      const chName = stream.channelName.toLowerCase();
      const chDisp = stream.channelDisplayName.toLowerCase();

      if (chName.includes(normalizedQuery) || chDisp.includes(normalizedQuery)) {
        const key = stream.channelName.toLowerCase();
        console.debug(
          `[KickSearch] Step 4: Found fuzzy match "${stream.channelName}" in top streams`
        );
        const newChannel: UnifiedChannel = {
          id: stream.channelId,
          platform: "kick",
          username: stream.channelName,
          displayName: stream.channelDisplayName,
          avatarUrl: stream.channelAvatar,
          bannerUrl: "",
          bio: "",
          isLive: true,
          isVerified: false,
          isPartner: false,
        };
        results.set(key, mergeChannel(results.get(key), newChannel, false)); // Step 4 is NOT authoritative - don't override live status
      }
    }
  } catch (e) {
    console.warn("Failed to fetch top streams for search fallback", e);
  }

  // Live status is set authoritatively downstream in
  // verifyAndEnrichKickChannels (search-handlers.ts) via the batched
  // /channels?slug[]=... call, so an extra round of getPublicChannel calls
  // here would just open more BrowserWindows for data we're about to refetch.

  const finalResults = Array.from(results.values());
  console.debug(`[KickSearch] Final results for "${query}": ${finalResults.length} channels`);
  return { data: finalResults };
}

/**
 * Full search across channels, categories, streams, videos, and clips
 * Note: Limited by official API capabilities
 */
export async function search(
  client: KickRequestor,
  query: string
): Promise<{ channels: any[]; categories: any[]; streams: any[]; videos: any[]; clips: any[] }> {
  const categoriesResult = await searchCategories(client, query);
  const channelsResult = await searchChannels(client, query);

  // If we found channels, check if they are live and get their stream info
  const streams: UnifiedStream[] = [];

  // Kick search currently only supports exact slug match, so channelsResult will likely have 0 or 1 item
  for (const channel of channelsResult.data) {
    if (channel.isLive) {
      // Since we already have the channel, we could optimize this,
      // but getStreamBySlug handles the /livestreams fetch and transformation
      const stream = await getStreamBySlug(client, channel.username);
      if (stream) {
        streams.push(stream);
      }
    }
  }

  return {
    channels: channelsResult.data,
    categories: categoriesResult.data,
    streams,
    videos: [],
    clips: [],
  };
}
