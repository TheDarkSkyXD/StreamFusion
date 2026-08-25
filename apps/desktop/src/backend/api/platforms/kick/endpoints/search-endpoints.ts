import { logger } from "@/backend/logging/logger";
import { compactSearchIdentity } from "@/search/search-normalization";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../../unified/platform-types";
import type { KickRequestor } from "../kick-requestor";
import { acquireKickRequestSlot } from "../kick-network-health";
import type { PaginatedResult, PaginationOptions } from "../kick-types";

import { searchCategories } from "./category-endpoints";
import { getChannel } from "./channel-endpoints";
import { getPublicTopStreams, getStreamBySlug } from "./stream-endpoints";

const PUBLIC_SEARCH_TOTAL_BUDGET_MS = 3000;
const LIVE_SEARCH_PAGE_SIZE = 100;
const LIVE_SEARCH_MAX_PAGES_PER_REQUEST = 5;

export type ChannelSearchOptions = PaginationOptions & {
  after?: string;
  first?: number;
  liveOnly?: boolean;
};

function streamMatchesQuery(stream: UnifiedStream, normalizedQuery: string): boolean {
  const channelName = stream.channelName.toLowerCase();
  const displayName = stream.channelDisplayName.toLowerCase();
  if (channelName.includes(normalizedQuery) || displayName.includes(normalizedQuery)) return true;

  const compactQuery = compactSearchIdentity(normalizedQuery);
  return (
    compactQuery.length > 0 &&
    [channelName, displayName].some((identity) =>
      compactSearchIdentity(identity).startsWith(compactQuery)
    )
  );
}

function streamToChannel(stream: UnifiedStream): UnifiedChannel {
  return {
    id: stream.channelId,
    platform: "kick",
    username: stream.channelName,
    displayName: stream.channelDisplayName,
    avatarUrl: stream.channelAvatar,
    bannerUrl: "",
    bio: "",
    isLive: true,
    isVerified: !!stream.channelIsVerified,
    isPartner: false,
    accountStatus: "active",
  };
}

type PublicSearchRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PublicSearchRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: PublicSearchRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function booleanField(record: PublicSearchRecord, ...keys: string[]): boolean {
  return keys.some((key) => record[key] === true);
}

async function fetchPublicSearchPayload(searchQuery: string): Promise<unknown | null> {
  const deadline = Date.now() + PUBLIC_SEARCH_TOTAL_BUDGET_MS;
  const searchEndpoints =
    searchQuery.length < 3
      ? [
          `https://kick.com/api/search/channel?searched_word=${encodeURIComponent(searchQuery)}`,
          `https://kick.com/api/v1/search?q=${encodeURIComponent(searchQuery)}`,
          `https://kick.com/api/search?searched_word=${encodeURIComponent(searchQuery)}`,
        ]
      : [`https://kick.com/api/search?searched_word=${encodeURIComponent(searchQuery)}`];

  for (const searchUrl of searchEndpoints) {
    if (Date.now() >= deadline) break;
    const releaseSlot = await acquireKickRequestSlot();
    try {
      const remainingBudgetMs = deadline - Date.now();
      if (remainingBudgetMs <= 0) continue;
      const { net } = require("electron");
      const res: Response = await net.fetch(searchUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://kick.com/",
          Origin: "https://kick.com",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(remainingBudgetMs),
      });
      if (res.ok) {
        const body = await res.text();
        try {
          const parsed: unknown = JSON.parse(body);
          if (
            Array.isArray(parsed) ||
            (isRecord(parsed) && (Array.isArray(parsed.channels) || Array.isArray(parsed.data)))
          ) {
            logger.debug("Kick:Endpoints:Search", "Step 2: Got results from endpoint", {
              searchUrl,
            });
            return parsed;
          }
        } catch (_e) {
          if (body.trim().startsWith("<")) {
            logger.warn(
              "Kick:Endpoints:Search",
              "Step 2: Endpoint returned HTML (likely bot protection)"
            );
          }
        }
      } else if (res.status >= 400 && res.status < 500) {
        logger.debug("Kick:Endpoints:Search", "Step 2: Endpoint returned 4xx; trying next", {
          searchUrl,
          status: res.status,
        });
      }
    } catch (_e) {
      logger.debug("Kick:Endpoints:Search", "Step 2: Endpoint error; trying next", {
        searchUrl,
      });
    } finally {
      releaseSlot();
    }
  }

  return null;
}

function publicSearchChannels(payload: unknown): PublicSearchRecord[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.channels)
      ? payload.channels
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : [];
  const channels = candidates.filter(isRecord);
  if (payload !== null && channels.length === 0 && isRecord(payload)) {
    logger.debug("Kick:Endpoints:Search", "Step 2: Unknown response structure", {
      keys: Object.keys(payload),
    });
  }
  return channels;
}

/**
 * Search for channels (using categories search + livestreams)
 * Note: Official API doesn't have a direct channel search endpoint
 */
export async function searchChannels(
  client: KickRequestor,
  query: string,
  _options: ChannelSearchOptions = {}
): Promise<PaginatedResult<UnifiedChannel>> {
  // Kick official API doesn't support fuzzy channel search.
  // Strategy:
  // 1. Public Search: Use unofficial search endpoint (fuzzy & offline).
  // 2. Official Exact match: Try via authenticated API (redundancy).
  // 3. Fuzzy match (Live): Page through live streams and filter by slug/name.

  // IMPORTANT: Deduplicate by username (slug), not ID, since different API endpoints
  // return different ID formats for the same channel.
  const results = new Map<string, UnifiedChannel>();
  const normalizedQuery = query.toLowerCase().trim();
  const cursorIn = _options.after ?? _options.cursor;
  const isContinuationPage = !!cursorIn;
  const requestedLimit = Math.max(1, _options.first ?? _options.limit ?? 50);

  // Helper to merge channel data - prefer entries with more complete data
  // Priority: Step 2 (official exact) > Step 1 (search API) > Step 3 (top streams)
  // The channel's actual live status comes from Step 2 when authenticated.
  const mergeChannel = (
    existing: UnifiedChannel | undefined,
    newChannel: UnifiedChannel,
    isAuthoritativeSource: boolean = false
  ): UnifiedChannel => {
    if (!existing) return newChannel;

    // Prefer the entry with an avatar
    const hasAvatar = (c: UnifiedChannel) => !!c.avatarUrl && c.avatarUrl.length > 0;

    // For live status, let sources backed by the official channel lookup or
    // live-stream directory set the value. Public web search is still treated
    // as non-authoritative because it can be stale.
    const isLive = isAuthoritativeSource ? newChannel.isLive : existing.isLive;

    // Preserve enrichment fields across sources: a channel that appears in
    // Step 1 (has follower count, no avatar) and Step 3 (has avatar, no
    // follower count) would otherwise lose follower count when we pick the
    // avatar-bearing side. Prefer whichever side actually populated it.
    const followerCount = existing.followerCount ?? newChannel.followerCount;
    const isVerified = existing.isVerified || newChannel.isVerified;
    const isPartner = existing.isPartner || newChannel.isPartner;
    const accountStatus =
      existing.accountStatus === "suspended" || newChannel.accountStatus === "suspended"
        ? "suspended"
        : isAuthoritativeSource && newChannel.accountStatus
          ? newChannel.accountStatus
          : existing.accountStatus || newChannel.accountStatus;

    // Always prefer the entry with an avatar, but keep the authoritative live status
    if (hasAvatar(newChannel) && !hasAvatar(existing)) {
      return { ...newChannel, isLive, isVerified, isPartner, accountStatus, followerCount };
    }
    // If existing has avatar but new doesn't, keep existing but merge avatar if new has one
    if (hasAvatar(existing)) {
      return { ...existing, isLive, isVerified, isPartner, accountStatus, followerCount };
    }
    // Neither has avatar, keep existing with merged data
    return {
      ...existing,
      isLive,
      avatarUrl: newChannel.avatarUrl || existing.avatarUrl,
      isVerified,
      isPartner,
      accountStatus,
      followerCount,
    };
  };

  // Continuation pages are live-directory pages only. Kick's public web search
  // does not expose a cursor, so repeating it would duplicate page 1 forever.
  if (!isContinuationPage) {
    // 1. Try public search endpoint (Unofficial - Works for offline & fuzzy).
    // Avoid getPublicChannel here: it opens a hidden BrowserWindow and can wait
    // behind a global 10s mutex. Search should stay fast; the channel page still
    // hydrates full metadata after navigation.
    // For short queries (1-2 chars), try multiple endpoints since main one returns 400
    // Endpoint options:
    // - https://kick.com/api/search?searched_word=query (main, needs 3+ chars)
    // - https://kick.com/api/search/channel?searched_word=query (might work for short)
    try {
      logger.debug("Kick:Endpoints:Search", "Step 1: Querying public search endpoint", {
        query: normalizedQuery,
      });

      const originalPayloadPromise = fetchPublicSearchPayload(normalizedQuery);
      const compactQuery = compactSearchIdentity(normalizedQuery);
      const compactPayloadPromise =
        compactQuery.length >= 3 && compactQuery !== normalizedQuery
          ? fetchPublicSearchPayload(compactQuery)
          : Promise.resolve(null);

      const [data, compactPayload] = await Promise.all([
        originalPayloadPromise,
        compactPayloadPromise,
      ]);
      if (!data && !compactPayload) {
        logger.debug("Kick:Endpoints:Search", "Step 2: No results from any search endpoint");
      }

      const channelsArray = publicSearchChannels(data);
      channelsArray.push(...publicSearchChannels(compactPayload));

      if (channelsArray.length > 0) {
        logger.debug("Kick:Endpoints:Search", "Step 2: Found results", {
          count: channelsArray.length,
        });

        for (const item of channelsArray) {
          // Try different possible ID and slug fields
          const channelId = stringField(item, "id", "user_id", "channel_id");
          const channelSlug = stringField(item, "slug", "channel_slug", "username");

          // The user object may contain the profile picture
          const userObj = isRecord(item.user) ? item.user : {};

          // Try multiple possible avatar field names - Kick uses various formats
          const avatarUrl =
            stringField(item, "profile_pic", "profile_picture", "profilePic", "avatar") ||
            stringField(
              userObj,
              "profile_pic",
              "profile_picture",
              "profilePic",
              "profile_image",
              "avatar"
            ) ||
            (isRecord(item.thumbnail) ? stringField(item.thumbnail, "url") : undefined) ||
            stringField(item, "thumbnail_url") ||
            "";

          if (channelSlug) {
            const key = channelSlug.toLowerCase();
            // /api/search returns followers_count on every channel; the official
            // /public/v1/channels endpoint does not, so this is the only batched
            // source for unauthenticated Kick search.
            const rawFollowers =
              typeof item.followers_count === "number"
                ? item.followers_count
                : typeof item.followersCount === "number"
                  ? item.followersCount
                  : undefined;
            const newChannel: UnifiedChannel = {
              id: channelId || `kick-${channelSlug}`,
              platform: "kick",
              username: channelSlug,
              displayName:
                stringField(item, "username") ||
                stringField(userObj, "username", "name") ||
                stringField(item, "display_name") ||
                channelSlug,
              avatarUrl,
              bannerUrl: "",
              bio: "",
              // /api/search exposes the channel's live state. Previously this was
              // hard-coded to false to avoid trusting "stale" values, but combined
              // with the merge-keeps-existing rule that meant Step 2 silently
              // clobbered Step 4's isLive: true for currently-live channels. The
              // search API agrees with /livestreams in practice, so we read it.
              isLive: item.isLive === true,
              isVerified: booleanField(
                item,
                "verified",
                "is_verified",
                "partner",
                "is_partner",
                "isPartner"
              ),
              isPartner: booleanField(item, "partner", "is_partner", "isPartner"),
              accountStatus: item.is_banned === true ? "suspended" : "active",
              followerCount: rawFollowers,
            };

            // Note: The Kick search API doesn't include avatars - they're only available
            // from direct channel lookups (Step 1 and Step 3). For channels without an
            // exact slug match, the UI will show a letter fallback.

            results.set(key, mergeChannel(results.get(key), newChannel, false)); // Step 2 is NOT authoritative
          }
        }
      }
    } catch (e) {
      logger.warn("Kick:Endpoints:Search", "Step 2: Error querying public search endpoint", {
        error:
          e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      });
    }

    // 3. Try official exact slug match (Official API - Requires Auth)
    if (client.isAuthenticated()) {
      try {
        logger.debug("Kick:Endpoints:Search", "Step 3: Checking official API", {
          query: normalizedQuery,
        });
        const channel = await getChannel(client, normalizedQuery);
        if (channel) {
          logger.debug("Kick:Endpoints:Search", "Step 3: Found channel", {
            username: channel.username,
          });
          const key = channel.username.toLowerCase();
          results.set(key, mergeChannel(results.get(key), channel, true));
        }
      } catch (e) {
        logger.warn("Kick:Endpoints:Search", "Step 3: Error fetching official channel", {
          query: normalizedQuery,
          error:
            e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
        });
      }
    }
  }

  // 4. Page through live channels only when the direct sources found no
  // candidates (or this is a cursor continuation). The directory is expensive
  // and was previously scanned on every search, even after the public search
  // had already supplied useful suggestions.
  let nextCursor: string | undefined;
  const hasLiveCandidate = Array.from(results.values()).some((channel) => channel.isLive);
  const shouldSearchLiveDirectory =
    isContinuationPage || results.size === 0 || (_options.liveOnly && !hasLiveCandidate);
  if (shouldSearchLiveDirectory) {
    try {
      logger.debug(
        "Kick:Endpoints:Search",
        "Step 4: Checking live stream pages for fuzzy matches",
        {
          cursor: cursorIn,
          requestedLimit,
        }
      );

      let cursor = cursorIn;
      let matchesFound = 0;

      for (let page = 0; page < LIVE_SEARCH_MAX_PAGES_PER_REQUEST; page++) {
        const streamPage = await getPublicTopStreams({
          limit: LIVE_SEARCH_PAGE_SIZE,
          cursor,
        });

        logger.debug("Kick:Endpoints:Search", "Step 4: Live stream page to filter", {
          page,
          count: streamPage.data.length,
          cursor,
          nextCursor: streamPage.cursor,
        });

        for (const stream of streamPage.data) {
          if (!streamMatchesQuery(stream, normalizedQuery)) continue;

          const key = stream.channelName.toLowerCase();
          logger.debug("Kick:Endpoints:Search", "Step 4: Found fuzzy match in live streams", {
            channelName: stream.channelName,
          });
          results.set(key, mergeChannel(results.get(key), streamToChannel(stream), true));
          matchesFound++;
        }

        if (!streamPage.cursor || streamPage.cursor === cursor) {
          nextCursor = undefined;
          break;
        }

        nextCursor = streamPage.cursor;
        cursor = streamPage.cursor;

        if (matchesFound >= requestedLimit) break;
      }
    } catch (e) {
      logger.warn(
        "Kick:Endpoints:Search",
        "Failed to fetch live stream pages for search fallback",
        {
          error:
            e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
        }
      );
    }
  }

  // Live status is set authoritatively downstream in
  // verifyAndEnrichKickChannels (search-handlers.ts) via the batched
  // /channels?slug[]=... call, so an extra round of getPublicChannel calls
  // here would just open more BrowserWindows for data we're about to refetch.

  const finalResults = Array.from(results.values());
  logger.debug("Kick:Endpoints:Search", "Final results", {
    query,
    channelCount: finalResults.length,
    cursor: nextCursor,
  });
  return { data: finalResults, cursor: nextCursor };
}

/**
 * Full search across channels, categories, streams, videos, and clips
 * Note: Limited by official API capabilities
 */
export async function search(
  client: KickRequestor,
  query: string,
  options: { channelSeeds?: UnifiedChannel[]; signal?: AbortSignal } = {}
): Promise<{
  channels: UnifiedChannel[];
  categories: UnifiedCategory[];
  streams: UnifiedStream[];
  videos: UnifiedVideo[];
  clips: UnifiedClip[];
}> {
  const [categoriesResult, channelsResult] = await Promise.all([
    searchCategories(client, query, { signal: options.signal }),
    options.channelSeeds
      ? Promise.resolve({ data: options.channelSeeds })
      : searchChannels(client, query),
  ]);

  // If we found channels, check if they are live and get their stream info
  const streams: UnifiedStream[] = [];

  for (const channel of channelsResult.data.filter((candidate) => candidate.isLive)) {
    if (options.signal?.aborted) break;

    try {
      const stream = await getStreamBySlug(client, channel.username);
      if (stream) streams.push(stream);
    } catch (error) {
      logger.debug("Kick:Endpoints:Search", "Failed to hydrate live stream result", {
        channel: channel.username,
        error: error instanceof Error ? error.message : String(error),
      });
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
