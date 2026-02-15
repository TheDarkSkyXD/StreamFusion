import type { UnifiedStream } from "../../../unified/platform-types";
import type { KickRequestor } from "../kick-requestor";
import { normalizeKickDate, transformKickLivestream } from "../kick-transformers";
import {
  KICK_LEGACY_API_V1_BASE,
  type KickApiLivestream,
  type KickApiResponse,
  type PaginatedResult,
  type PaginationOptions,
} from "../kick-types";

import { getChannel } from "./channel-endpoints";
import { getUsersById } from "./user-endpoints";

let _topStreamsCache: { data: UnifiedStream[]; timestamp: number } | null = null;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// Cache for display name lookups to avoid redundant requests
const _displayNameCache = new Map<
  string,
  { displayName: string; avatar: string; timestamp: number }
>();
const DISPLAY_NAME_CACHE_TTL = 1000 * 60 * 30; // 30 minutes
const MAX_CACHE_SIZE = 1000; // Limit cache to 1000 entries

// Periodically clean expired entries to prevent memory leaks
// Using .unref() so the interval doesn't prevent graceful shutdown
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of _displayNameCache.entries()) {
      if (now - value.timestamp >= DISPLAY_NAME_CACHE_TTL) {
        _displayNameCache.delete(key);
      }
    }
    // Also enforce max size by removing oldest entries
    if (_displayNameCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(_displayNameCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );
      const toRemove = entries.slice(0, _displayNameCache.size - MAX_CACHE_SIZE);
      toRemove.forEach(([key]) => _displayNameCache.delete(key));
    }
  },
  1000 * 60 * 5
).unref(); // Clean every 5 minutes

/**
 * Lightweight function to fetch just display name and avatar for a channel
 * Uses net.request (fast) instead of BrowserWindow (slow)
 */
async function getChannelDisplayInfo(
  slug: string
): Promise<{ displayName: string; avatar: string } | null> {
  // Check cache first
  const cached = _displayNameCache.get(slug.toLowerCase());
  if (cached && Date.now() - cached.timestamp < DISPLAY_NAME_CACHE_TTL) {
    return { displayName: cached.displayName, avatar: cached.avatar };
  }

  try {
    const { net } = require("electron");

    const data = await new Promise<any>((resolve, _reject) => {
      const request = net.request({
        method: "GET",
        url: `${KICK_LEGACY_API_V1_BASE}/channels/${slug}`,
      });

      request.setHeader("Accept", "application/json");
      request.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      request.setHeader("Referer", "https://kick.com/");
      request.setHeader("Accept-Language", "en-US,en;q=0.9");

      const timeout = setTimeout(() => {
        request.abort();
        resolve(null);
      }, 3000); // 3 second timeout

      request.on("response", (response: any) => {
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      });

      request.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });

      request.end();
    });

    if (!data) return null;

    // Prefer official API field (profile_picture) over legacy (profile_pic)
    // Official API returns kick.com/img/... URLs which work directly
    // Legacy API returns files.kick.com/... URLs which may return 403
    const result = {
      displayName: data.user?.username || slug,
      avatar: data.user?.profile_picture || data.user?.profile_pic || data.user?.profilepic || "",
    };

    // Cache the result
    _displayNameCache.set(slug.toLowerCase(), { ...result, timestamp: Date.now() });

    return result;
  } catch {
    return null;
  }
}

/**
 * Get stream info using the public/legacy API (No Auth Required)
 * Includes retry logic for transient server errors (502, 503, 504)
 */
export async function getPublicStreamBySlug(slug: string): Promise<UnifiedStream | null> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { net } = require("electron");

      const data = await new Promise<any>((resolve, reject) => {
        const request = net.request({
          method: "GET",
          url: `${KICK_LEGACY_API_V1_BASE}/channels/${slug}`,
        });

        request.setHeader("Accept", "application/json");
        request.setHeader(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        request.setHeader("Referer", "https://kick.com/");
        request.setHeader("X-Requested-With", "XMLHttpRequest");

        request.on("response", (response: any) => {
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }

          // Transient server errors - should retry
          if (
            response.statusCode === 502 ||
            response.statusCode === 503 ||
            response.statusCode === 504
          ) {
            reject(new Error(`TRANSIENT:${response.statusCode}`));
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Status ${response.statusCode}`));
            return;
          }

          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });

          response.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (_e) {
              console.warn(`[KickStream] Failed to parse JSON for ${slug}`);
              reject(new Error("Failed to parse JSON"));
            }
          });
        });

        request.on("error", (error: Error) => {
          reject(error);
        });

        request.end();
      });

      if (!data) return null;

      const livestream = data.livestream;
      if (!livestream) return null;

      // Map legacy livestream to UnifiedStream
      // Prefer profile_picture (official API) over profile_pic (legacy API)
      return {
        id: livestream.id.toString(),
        platform: "kick",
        channelId: livestream.channel_id.toString(),
        channelName: data.slug,
        channelDisplayName: data.user?.username || data.slug,
        channelAvatar: data.user?.profile_picture || data.user?.profile_pic || data.user?.profilepic || "",
        title: livestream.session_title || "",
        viewerCount: livestream.viewer_count ?? livestream.viewers ?? 0,
        thumbnailUrl: livestream.thumbnail?.url || "",
        isLive: true,
        startedAt: normalizeKickDate(livestream.created_at),
        language: livestream.language || "en",
        tags:
          livestream.custom_tags && livestream.custom_tags.length > 0
            ? livestream.custom_tags
            : livestream.tags || [],
        isMature: livestream.is_mature ?? false,
        categoryId: livestream.categories?.[0]?.id?.toString() || "",
        categoryName: livestream.categories?.[0]?.name || "",
      };
    } catch (error: any) {
      lastError = error;

      // Check if this is a transient error that should be retried
      if (error.message?.startsWith("TRANSIENT:")) {
        const statusCode = error.message.split(":")[1];
        // Don't delay after the final attempt
        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * 2 ** attempt; // 1s, 2s, 4s
          console.debug(
            `[KickStream] Got ${statusCode} for ${slug}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
        continue;
      }

      // Non-transient error - don't retry
      break;
    }
  }

  // All retries exhausted or non-transient error
  if (lastError) {
    console.warn(`Failed to fetch public Kick stream ${slug}:`, lastError);
  }
  return null;
}

/**
 * Get livestream by channel slug
 *
 * ROBUST FIX: Uses public API first to avoid authenticated API identity mismatch bugs
 */
export async function getStreamBySlug(
  client: KickRequestor,
  slug: string
): Promise<UnifiedStream | null> {
  const normalizedSlug = slug.toLowerCase().trim();

  // STRATEGY: Use public API first as it's more reliable for single-channel lookups
  // The authenticated API has known bugs with identity mismatches
  try {
    const publicStream = await getPublicStreamBySlug(slug);
    if (publicStream) {
      // Validate the returned stream matches what we requested
      if (publicStream.channelName.toLowerCase() === normalizedSlug) {
        return publicStream;
      } else {
        console.warn(
          `[Kick] Public stream API mismatch: requested "${slug}", got "${publicStream.channelName}". ` +
          `Trying authenticated API.`
        );
      }
    }
  } catch (e) {
    console.debug(`Public stream API failed for ${slug}, trying authenticated API:`, e);
  }

  // Fallback to official API if public API fails or returns mismatched data
  try {
    const channel = await getChannel(client, slug);

    // Validate channel matches requested slug
    if (channel && channel.username.toLowerCase() !== normalizedSlug) {
      console.warn(
        `[Kick] Channel lookup mismatch: requested "${slug}", got "${channel.username}". ` +
        `Rejecting to prevent identity confusion.`
      );
      return null;
    }

    if (channel?.isLive) {
      // Need to get full stream data from livestreams endpoint
      try {
        const channelIdNum = parseInt(channel.id, 10);
        if (Number.isNaN(channelIdNum)) {
          console.warn(`[Kick] Invalid channel ID "${channel.id}" for stream ${slug}`);
          return null;
        }

        const response = await client.request<KickApiResponse<KickApiLivestream[]>>(
          `/livestreams?broadcaster_user_id=${channelIdNum}`
        );

        if (response.data && response.data.length > 0) {
          const apiStream = response.data[0];

          // CRITICAL: Validate the stream's broadcaster ID matches the channel ID we queried
          if (apiStream.broadcaster_user_id !== channelIdNum) {
            console.warn(
              `[Kick] Stream broadcaster ID mismatch: queried for ${channelIdNum}, ` +
              `got ${apiStream.broadcaster_user_id}. Rejecting to prevent identity confusion.`
            );
            return null;
          }

          const stream = transformKickLivestream(apiStream);

          // Final validation: ensure stream channel matches requested slug
          if (stream.channelName.toLowerCase() !== normalizedSlug) {
            console.warn(
              `[Kick] Stream channel name mismatch: requested "${slug}", ` +
              `got "${stream.channelName}". Rejecting.`
            );
            return null;
          }

          // Use channel display name if available and better than what we have
          if (channel.displayName && channel.displayName !== channel.username) {
            stream.channelDisplayName = channel.displayName;
          }
          if (channel.avatarUrl) {
            stream.channelAvatar = channel.avatarUrl;
          }

          // Enrich with user avatar and name from fresh user fetch (with defensive checks)
          try {
            const streamChannelIdNum = parseInt(stream.channelId, 10);
            if (!Number.isNaN(streamChannelIdNum)) {
              const users = await getUsersById(client, [streamChannelIdNum]);
              if (users.length > 0) {
                const user = users[0];

                // CRITICAL: Verify ID match to prevent incorrect user data
                if (user.user_id.toString() === stream.channelId) {
                  if (user.profile_picture) {
                    stream.channelAvatar = user.profile_picture;
                  }
                  if (user.name) {
                    stream.channelDisplayName = user.name;
                  }
                } else {
                  console.warn(
                    `[Kick] User ID mismatch for stream ${slug}: ` +
                    `fetched user ID ${user.user_id}, expected ${stream.channelId}. ` +
                    `Skipping user data enrichment.`
                  );
                }
              }
            }
          } catch (e) {
            console.debug(`Failed to enrich user info for stream ${slug}:`, e);
            // Not critical - stream data is still valid without user enrichment
          }

          return stream;
        }
      } catch (error) {
        console.warn(`Failed to fetch Kick stream details for ${slug}:`, error);
      }
    }
  } catch (e) {
    console.warn(`Authenticated stream API failed for ${slug}:`, e);
  }

  // All methods failed
  return null;
}

/**
 * Get top streams using the legacy public API
 * Uses Electron's net module to bypass CORS and Cloudflare protection
 * Tries multiple endpoints for better coverage
 */
export async function getPublicTopStreams(
  options: PaginationOptions & { categoryId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  try {
    const { net } = require("electron");
    const language = options.language || "en";

    // Try multiple endpoints - some may be blocked or return limited data
    const endpoints = [
      `https://kick.com/stream/livestreams/${language}`,
      `https://kick.com/stream/featured-livestreams/${language}`,
      `https://api.kick.com/private/v1/livestreams`,
    ];

    let bestData: any = null;
    let bestCount = 0;

    for (const url of endpoints) {
      try {
        const data = await new Promise<any>((resolve) => {
          const request = net.request({
            method: "GET",
            url: url,
          });

          request.setHeader("Accept", "application/json");
          request.setHeader(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          );
          request.setHeader("Referer", "https://kick.com/");
          request.setHeader("Origin", "https://kick.com");
          request.setHeader("X-Requested-With", "XMLHttpRequest");

          // Timeout after 5 seconds
          const timeout = setTimeout(() => {
            request.abort();
            resolve(null);
          }, 5000);

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
                  resolve(parsed);
                } catch {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            });
          });

          request.on("error", () => {
            clearTimeout(timeout);
            resolve(null);
          });

          request.end();
        });

        if (data) {
          const rawList = Array.isArray(data) ? data : data.data || data.livestreams || [];

          if (rawList.length > bestCount) {
            bestData = data;
            bestCount = rawList.length;
          }

          // If we got a good number of streams, stop trying
          if (rawList.length >= 50) {
            break;
          }
        }
      } catch {
        // Ignore fetch errors, try next endpoint
      }
    }

    if (!bestData) {
      return { data: [] };
    }

    const streams: UnifiedStream[] = [];

    // Handle different response formats
    const rawList = Array.isArray(bestData)
      ? bestData
      : bestData.data || bestData.livestreams || [];

    for (const item of rawList) {
      // Basic validation - handle different response structures
      // IMPORTANT: Prefer item.channel?.slug (the actual channel slug like "xqc")
      // over item.slug which is the LIVESTREAM slug (UUID-prefixed, e.g., "f084f107-atl-w-...")
      // The legacy endpoint kick.com/stream/livestreams/en returns item.slug as a livestream slug
      const slug = item.channel?.slug || item.broadcaster_username || item.slug;
      if (!item || !slug) continue;

      // Extract thumbnail URL - different endpoints use different field structures
      const thumbnailUrl =
        item.thumbnail?.url ||
        item.thumbnail?.src ||
        item.thumbnail_url ||
        (typeof item.thumbnail === "string" ? item.thumbnail : "") ||
        item.livestream?.thumbnail?.url ||
        "";

      // Extract avatar URL - different endpoints use different field structures
      // IMPORTANT: Prefer official API field (profile_picture) over legacy (profilepic/profile_pic)
      // Official API returns kick.com/img/... URLs which work directly
      // Legacy API returns files.kick.com/... URLs which may return 403 but still useful as fallback
      const avatarUrl =
        item.profile_picture || // Official API field (kick.com/img/... - works!)
        item.user?.profile_picture ||
        item.channel?.user?.profile_picture ||
        item.channel?.user?.profilepic || // Legacy API field (no underscore!)
        item.user?.profile_pic || // Legacy API field (files.kick.com - may 403)
        item.channel?.user?.profile_pic ||
        "";

      // Extract category - legacy endpoint nests categories in an array
      const categoryId = (
        item.category_id ||
        item.category?.id ||
        item.categories?.[0]?.id ||
        ""
      ).toString();
      const categoryName =
        item.category?.name || item.categories?.[0]?.name || "";

      streams.push({
        id: (item.id || item.session_id || "").toString(),
        platform: "kick",
        channelId: (
          item.channel?.id ||
          item.channel_id ||
          item.broadcaster_user_id ||
          item.channel?.user_id ||
          item.user_id ||
          ""
        ).toString(),
        channelName: slug,
        channelDisplayName:
          item.channel?.user?.username ||
          item.user?.username ||
          item.broadcaster_display_name ||
          item.broadcaster_name ||
          item.broadcaster_username ||
          slug,
        channelAvatar: avatarUrl,
        title: item.session_title || item.title || "",
        viewerCount: item.viewer_count ?? item.viewers ?? 0,
        thumbnailUrl: thumbnailUrl,
        isLive: true,
        startedAt: normalizeKickDate(item.created_at || item.start_time),
        language: item.language || language,
        tags: item.custom_tags && item.custom_tags.length > 0 ? item.custom_tags : item.tags || [],
        isMature: item.is_mature ?? item.has_mature_content ?? false,
        categoryId,
        categoryName,
      });
    }

    // Manual filter and sort since this endpoint is a "dump"
    if (options.limit && streams.length > options.limit) {
      streams.length = options.limit; // Truncate
    }

    return { data: streams };
  } catch {
    return { data: [] };
  }
}

/**
 * Get top/featured live streams
 * https://docs.kick.com/apis/livestreams - GET /public/v1/livestreams
 */
export async function getTopStreams(
  client: KickRequestor,
  options: PaginationOptions & { categoryId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  try {
    const params = new URLSearchParams();

    if (options.limit) {
      params.set("limit", options.limit.toString());
    }
    if (options.categoryId) {
      params.set("category_id", options.categoryId);
    }
    if (options.language) {
      params.set("language", options.language);
    }
    // Default sort by viewer count (highest first)
    params.set("sort", "viewer_count");

    const queryString = params.toString();
    const endpoint = queryString ? `/livestreams?${queryString}` : "/livestreams";

    const response = await client.request<KickApiResponse<KickApiLivestream[]>>(endpoint);
    const rawStreams = response.data || [];

    // Fetch avatars
    // Note: With App Token, getting users might fail if we hit rate limits or if it requires user scope
    // But /users endpoint usually works with App Token for public profiles
    const userIds = rawStreams.map((s) => s.broadcaster_user_id);

    let userMap = new Map<number, any>();
    try {
      // Only fetch if we have streams
      if (userIds.length > 0) {
        const users = await getUsersById(client, userIds);
        userMap = new Map(users.map((u) => [u.user_id, u]));
      }
    } catch (e) {
      console.warn("Failed to fetch user avatars for streams:", e);
    }

    const streams = rawStreams.map((s) => {
      const stream = transformKickLivestream(s);
      const user = userMap.get(s.broadcaster_user_id);
      if (user) {
        if (user.profile_picture) {
          stream.channelAvatar = user.profile_picture;
        }
        if (user.name) {
          stream.channelDisplayName = user.name;
        }
      }
      return stream;
    });

    // If we couldn't enrich with user data (unauthenticated or rate limited),
    // the display names will still be lowercase slugs.
    // Fetch individual channel data which has properly capitalized display names.
    if (userMap.size === 0 && streams.length > 0) {
      try {
        // Get unique slugs that need enrichment
        const uniqueSlugs = [...new Set(streams.map((s) => s.channelName))];

        // Fetch channel data in small batches to avoid rate limiting (429)
        // Reduced from 15 to 3 concurrent requests with delay between batches
        const displayNameMap = new Map<string, { displayName: string; avatar: string }>();
        const batchSize = 3; // Reduced from 15 to avoid 429 rate limits
        const batchDelayMs = 200; // Add delay between batches

        for (let i = 0; i < uniqueSlugs.length; i += batchSize) {
          // Add delay between batches (not before first batch)
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
          }

          const batch = uniqueSlugs.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (slug) => {
              const info = await getChannelDisplayInfo(slug);
              if (info) {
                return { slug, ...info };
              }
              return null;
            })
          );

          for (const result of results) {
            if (result?.displayName) {
              displayNameMap.set(result.slug.toLowerCase(), {
                displayName: result.displayName,
                avatar: result.avatar || "",
              });
            }
          }
        }

        // Enrich streams with properly capitalized display names and avatars
        for (const stream of streams) {
          const data = displayNameMap.get(stream.channelName.toLowerCase());
          if (data) {
            if (data.displayName && data.displayName !== stream.channelName) {
              stream.channelDisplayName = data.displayName;
            }
            if (data.avatar && !stream.channelAvatar) {
              stream.channelAvatar = data.avatar;
            }
          }
        }
      } catch {
        // Silently ignore enrichment failures - streams will just have lowercase names
      }
    }

    return {
      data: streams,
    };
  } catch (error) {
    // Unauthenticated or API error → use public (no-auth) API
    console.debug(
      "[Kick] Using public API for top streams (no user auth):",
      error instanceof Error ? error.message : error
    );
    // Fallback to public API on error
    return getPublicTopStreams(options);
  }
}

/**
 * Get or fetch valid cached top streams for fuzzy search
 */
export async function getTopStreamsCached(client: KickRequestor): Promise<UnifiedStream[]> {
  const now = Date.now();
  if (
    _topStreamsCache &&
    now - _topStreamsCache.timestamp < CACHE_TTL &&
    _topStreamsCache.data.length > 0
  ) {
    return _topStreamsCache.data;
  }

  try {
    // Only try official API if authenticated to avoid 429 rate limits
    if (client.isAuthenticated()) {
      try {
        const result = await getTopStreams(client, { limit: 100 });
        if (result.data.length > 0) {
          _topStreamsCache = {
            data: result.data,
            timestamp: now,
          };
          return result.data;
        }
      } catch (_e) {
        console.warn("Official API top streams failed, trying fallback");
      }
    }

    // Fallback to public API
    const publicResult = await getPublicTopStreams({ limit: 100 });
    if (publicResult.data.length > 0) {
      _topStreamsCache = {
        data: publicResult.data,
        timestamp: now,
      };
    }
    return publicResult.data;
  } catch (e) {
    console.warn("Failed to refresh top streams cache", e);
    // Return stale cache if available, otherwise empty
    return _topStreamsCache?.data || [];
  }
}

/**
 * Get streams by category
 * https://docs.kick.com/apis/livestreams - GET /public/v1/livestreams?category_id=:id
 */
export async function getStreamsByCategory(
  client: KickRequestor,
  categoryId: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  return getTopStreams(client, { ...options, categoryId });
}

/**
 * Get followed streams (live channels the user follows)
 * Note: Official API doesn't have a direct followed streams endpoint
 */
export async function getFollowedStreams(
  _client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // The official API doesn't have a followed streams endpoint
  // Would need to first get followed channels, then check which are live
  console.warn("⚠️ Kick official API does not support followed streams directly");
  return { data: [] };
}
