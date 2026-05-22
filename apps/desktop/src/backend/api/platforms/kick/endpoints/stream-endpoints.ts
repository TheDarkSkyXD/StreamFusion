import { net } from "electron";

import type { UnifiedStream } from "../../../unified/platform-types";
import {
  acquireKickRequestSlot,
  isNetworkLikelyDown,
  recordTransientNetworkError,
} from "../kick-network-health";
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

// Kick's slug-based category-livestreams endpoint (see getPublicStreamsByCategorySlug)
// requires a category SLUG, but the rest of the app addresses categories by their
// numeric id. This map is populated as a side-effect whenever we parse a Kick
// API response that carries both fields, so subsequent category-stream queries
// can translate id → slug without an extra round-trip.
const _categoryIdToSlug = new Map<string, string>();
// Exported so the category list fetcher in category-endpoints.ts can seed
// this cache up-front. Without it, Kick-exclusive categories that aren't in
// the global top-streams dump fail to render any streams when clicked —
// getPublicTopStreams falls back to filtering the global dump by id, which
// yields zero for niche categories that exist on Kick but never crack the
// top dump.
export function rememberCategorySlug(
  id: string | null | undefined,
  slug: string | null | undefined
) {
  if (id && slug) _categoryIdToSlug.set(String(id), String(slug));
}

/**
 * Kebab-case a category name into Kick's slug convention.
 * Kick slugs are deterministic lowercase-kebab forms of display names
 * (e.g. "Just Chatting" → "just-chatting", "Grand Theft Auto V" →
 * "grand-theft-auto-v"). Non-alphanumeric punctuation collapses to a hyphen.
 * Used as a fallback when we know a category name from the other platform but
 * haven't been able to map it to a Kick numeric id.
 */
export function toKickCategorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// Cache for display name lookups to avoid redundant requests
const _displayNameCache = new Map<
  string,
  { displayName: string; avatar: string; timestamp: number }
>();
const DISPLAY_NAME_CACHE_TTL = 1000 * 60 * 60; // 60 minutes — streamer renames are rare, fewer net.request fallbacks
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
    // Enforce max size via FIFO. `_displayNameCache.set()` only fires on miss
    // (never on a fresh-hit refresh), so JS Map insertion order ≈ first-seen
    // order ≈ oldest-first. Iterator delete is O(k) where k = overflow count,
    // versus the previous O(n log n) Array.from + sort.
    const overflow = _displayNameCache.size - MAX_CACHE_SIZE;
    if (overflow > 0) {
      const iter = _displayNameCache.keys();
      for (let i = 0; i < overflow; i++) {
        const next = iter.next();
        if (next.done) break;
        _displayNameCache.delete(next.value);
      }
    }
    // Evict stream-cache entries older than the longest consumer's TTL
    // (the 5-min outage stale-serve path). Both the 90s positive-cache
    // reader and the 5-min outage reader see fresher entries during normal
    // operation; entries older than this are unusable for either path.
    for (const [key, value] of _publicStreamSuccessCache.entries()) {
      if (now - value.timestamp >= PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
        _publicStreamSuccessCache.delete(key);
      }
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

  // Skip the round-trip during a known outage — the call has no retries and
  // would just return null, leaving displayName as the lowercase slug forever
  // in callers. Returning null here lets the next refetch try fresh.
  if (isNetworkLikelyDown()) return null;

  const releaseSlot = await acquireKickRequestSlot();
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
  } finally {
    releaseSlot();
  }
}

// In-flight dedupe: concurrent callers (sidebar refetch + hover prefetch + page
// open) share the same Promise instead of each spinning up its own net.request.
const _publicStreamInFlight = new Map<string, Promise<UnifiedStream | null>>();

// Negative cache for genuine failures (timeout/network/5xx after retries) only.
// Critical: "channel exists but is offline" returns null without being cached
// here, so we still detect a follow going live on the next poll. This cache
// just keeps the `useFollowedStreams` / `useStreamByChannel` refetch loops from
// re-hammering Kick for channels we already know are unreachable.
const _publicStreamFailureCache = new Map<string, number>();
// Warn-once: log the first failure per slug at `warn`, subsequent failures at
// `debug` so the log doesn't fill up with the same channel's timeout every few
// minutes. Cleared when the API responds successfully (so a recover-then-fail
// produces a fresh warning).
const _publicStreamWarnedSlugs = new Set<string>();

// Last-known-good cache. Only consulted when `isNetworkLikelyDown()` says the
// Chromium network service just crashed — we'd otherwise return null and the
// followed-sidebar would visibly drop every Kick channel for the duration of
// the outage. Serving the previous state (live OR offline) keeps the UI from
// flickering through a "channel went offline" frame and self-corrects on the
// next successful refetch. Caches the offline state too so a channel that was
// genuinely offline doesn't ghost-appear as live.
const _publicStreamSuccessCache = new Map<
  string,
  { data: UnifiedStream | null; timestamp: number }
>();
const PUBLIC_STREAM_OUTAGE_STALE_TTL_MS = 5 * 60 * 1000;
// 5-min lockout is fine for genuine API failures (DNS, 5xx, parse errors) where
// hammering Kick is pointless. But a single 5s timeout shouldn't blackhole the
// UI for 5 minutes — Kick's CDN/edge can flake transiently while playback is
// otherwise healthy, and the stream page reads streamData to decide whether to
// render the "is currently offline" overlay. Use a much shorter TTL for
// timeout-only failures so the next 30s refetch cycle has a real chance to
// recover the metadata instead of the cached null lingering for minutes.
const PUBLIC_STREAM_FAILURE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_STREAM_TIMEOUT_TTL_MS = 30 * 1000;
const PUBLIC_STREAM_REQUEST_TIMEOUT_MS = 5000;
// Normal-path positive cache. Distinct from PUBLIC_STREAM_OUTAGE_STALE_TTL_MS
// (which is a 5-min stale-serve window for the network-service-crash path).
// `useFollowedStreams` polls every 60s and `fetchKickFollowed` fan-outs all
// follows in parallel; with the global slot cap at 4 the first burst on a
// cold TLS connection consistently exhausts the 5s per-request timeout,
// producing `[KickStream] timeout … retrying` noise on every cycle even
// though attempt 1 then succeeds. A TTL above the 60s poll interval lets
// most polls hit the cache instead of re-bursting; keeping it under 2× the
// poll interval bounds "channel went live" detection latency to one extra
// cycle at worst.
const PUBLIC_STREAM_POLL_HIT_TTL_MS = 90 * 1000;

/**
 * Cancellable sleep used to stagger parallel network dispatches without
 * orphaning timers. Callers pass an AbortSignal from a per-invocation
 * AbortController; the next invocation aborts the prior one so pending
 * delays from stale dispatches reject instead of firing into the network.
 */
function staggerDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("AbortError"));
      return;
    }
    const timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Get stream info using the public/legacy API (No Auth Required)
 * Includes retry logic for transient server errors (502, 503, 504) and network
 * errors (timeouts, connection refused). Concurrent calls for the same slug
 * share an in-flight promise, and persistent failures are negative-cached for
 * `PUBLIC_STREAM_FAILURE_TTL_MS` so the 60s `useFollowedStreams` refetch loop
 * doesn't keep re-hitting a known-unreachable channel.
 *
 * `staggerOffsetMs` delays the network call by that many milliseconds when the
 * caller's positive / failure / outage caches all miss. Cache hits short-circuit
 * synchronously without delaying. `signal` cancels the stagger sleep so the
 * next dispatch can abort orphan timers from the prior one.
 */
export async function getPublicStreamBySlug(
  slug: string,
  staggerOffsetMs: number = 0,
  signal?: AbortSignal,
): Promise<UnifiedStream | null> {
  const key = slug.toLowerCase().trim();

  // Stale-during-outage: when Chromium's network service just crashed, every
  // fresh fetch will fail. Serving the last-known state keeps the UI from
  // visibly losing every Kick channel during the ~3s restart window. The
  // periodic refetch corrects the data once the service is back.
  if (isNetworkLikelyDown()) {
    const cached = _publicStreamSuccessCache.get(key);
    if (cached && Date.now() - cached.timestamp < PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
      return cached.data;
    }
  }

  const failExpiry = _publicStreamFailureCache.get(key);
  if (failExpiry !== undefined) {
    if (Date.now() < failExpiry) return null;
    _publicStreamFailureCache.delete(key);
  }

  // Positive cache hit: skip the network entirely when the previous fetch is
  // still fresh. Sits after the failure check so a fresh failure preempts a
  // stale-but-not-yet-expired success. The success cache stores both live
  // streams and known-offline (`data: null`) channels, so this also avoids
  // re-bursting for offline follows.
  const cachedSuccess = _publicStreamSuccessCache.get(key);
  if (
    cachedSuccess &&
    Date.now() - cachedSuccess.timestamp < PUBLIC_STREAM_POLL_HIT_TTL_MS
  ) {
    return cachedSuccess.data;
  }

  const inFlight = _publicStreamInFlight.get(key);
  if (inFlight) return inFlight;

  // Register the in-flight promise BEFORE the stagger so concurrent same-slug
  // callers dedupe against the staggered work, not against a "not started yet"
  // gap. The stagger only fires for cache-miss work; the cache checks above
  // short-circuit synchronously without delaying.
  const promise = (async () => {
    if (staggerOffsetMs > 0) {
      await staggerDelay(staggerOffsetMs, signal);
    }
    return _doFetchPublicStreamBySlug(slug, key);
  })();
  _publicStreamInFlight.set(key, promise);
  try {
    const result = await promise;
    // Catch the race where the network crashed mid-fetch: the call passed
    // the entry check but its requests failed with ERR_FAILED while the
    // service was going down. Serve the cached state so the sidebar doesn't
    // flicker just because the outage straddled the request.
    if (result === null && isNetworkLikelyDown()) {
      const cached = _publicStreamSuccessCache.get(key);
      if (cached && Date.now() - cached.timestamp < PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
        return cached.data;
      }
    }
    return result;
  } finally {
    _publicStreamInFlight.delete(key);
  }
}

async function _doFetchPublicStreamBySlug(
  slug: string,
  key: string
): Promise<UnifiedStream | null> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Short-circuit when Chromium's network service just crashed: every
    // in-flight net.request will fail with ERR_FAILED until restart, and
    // each retry just piles more requests onto the recovering service.
    // Surface as a normal timeout so the caller's short-TTL negative cache
    // applies and the next refetch cycle picks the metadata back up.
    if (isNetworkLikelyDown()) {
      lastError = new Error("TRANSIENT:timeout");
      break;
    }

    const releaseSlot = await acquireKickRequestSlot();
    try {
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

        // Without this, hung connections wait for Chromium's TCP timeout (~21s)
        // before surfacing as ERR_CONNECTION_TIMED_OUT. Fail fast so the 60s
        // refetch cycle doesn't stack up.
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          request.abort();
          reject(new Error("TRANSIENT:timeout"));
        }, PUBLIC_STREAM_REQUEST_TIMEOUT_MS);

        request.on("response", (response: any) => {
          if (response.statusCode === 404) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(null);
            return;
          }

          // Transient server errors - should retry
          if (
            response.statusCode === 502 ||
            response.statusCode === 503 ||
            response.statusCode === 504
          ) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`TRANSIENT:${response.statusCode}`));
            return;
          }

          if (response.statusCode !== 200) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`Status ${response.statusCode}`));
            return;
          }

          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });

          response.on("end", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
              resolve(JSON.parse(body));
            } catch (_e) {
              console.warn(`[KickStream] Failed to parse JSON for ${slug}`);
              reject(new Error("Failed to parse JSON"));
            }
          });
        });

        request.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          // Network errors (ERR_CONNECTION_TIMED_OUT, ERR_NAME_NOT_RESOLVED,
          // etc.) are transient from our perspective — retry with the same
          // backoff as 5xx.
          reject(new Error(`TRANSIENT:${error.message}`));
        });

        request.end();
      });

      // API responded successfully — clear any prior warn flag for this slug
      // so a future failure will warn again instead of being silently debug-ed.
      _publicStreamWarnedSlugs.delete(key);

      if (!data) return null;

      const livestream = data.livestream;
      // `data.livestream === null` means the channel exists but is offline.
      // Do NOT negative-cache: we want to detect them going live on the next
      // poll. We DO record the offline state in the success cache so that a
      // brief network-service outage doesn't ghost-promote it to "live".
      if (!livestream) {
        _publicStreamSuccessCache.set(key, { data: null, timestamp: Date.now() });
        return null;
      }

      // Map legacy livestream to UnifiedStream
      // Prefer profile_picture (official API) over profile_pic (legacy API)
      const result: UnifiedStream = {
        id: livestream.id.toString(),
        platform: "kick",
        channelId: livestream.channel_id.toString(),
        channelName: data.slug,
        channelDisplayName: data.user?.username || data.slug,
        channelAvatar:
          data.user?.profile_picture || data.user?.profile_pic || data.user?.profilepic || "",
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
      _publicStreamSuccessCache.set(key, { data: result, timestamp: Date.now() });
      return result;
    } catch (error: any) {
      lastError = error;

      // Check if this is a transient error that should be retried
      if (error.message?.startsWith("TRANSIENT:")) {
        const reason = error.message.split(":")[1];
        // Feed net::ERR_* failures into the health tracker so a burst across
        // concurrent slugs flips the global flag and the remaining retries
        // (here and at other Kick call sites) bail out fast.
        recordTransientNetworkError(error.message);
        if (isNetworkLikelyDown()) break;
        // Don't delay after the final attempt
        if (attempt < maxRetries - 1) {
          // Jitter ±25% so concurrent slugs don't all retry at the same
          // millisecond and form a synchronised thundering-herd against
          // Kick's edge.
          const base = 1000 * 2 ** attempt; // 1s, 2s, 4s
          const jitter = base * (0.75 + Math.random() * 0.5);
          const backoffMs = Math.round(jitter);
          console.debug(
            `[KickStream] ${reason} for ${slug}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
        continue;
      }

      // Non-transient error - don't retry
      break;
    } finally {
      releaseSlot();
    }
  }

  // All retries exhausted or non-transient error — negative-cache so the next
  // poll cycle doesn't keep slamming a channel we just spent ~18s failing to
  // reach, and warn-once so repeat failures don't spam the log.
  if (lastError) {
    if (_publicStreamWarnedSlugs.has(key)) {
      console.debug(`Failed to fetch public Kick stream ${slug}:`, lastError);
    } else {
      console.warn(`Failed to fetch public Kick stream ${slug}:`, lastError);
      _publicStreamWarnedSlugs.add(key);
    }
    // Short TTL for timeouts and known network-service outages (transient,
    // process-level — not the slug's fault); long TTL for everything else
    // (DNS, 5xx, parse errors — Kick is genuinely unhappy).
    const isTimeout = lastError.message === "TRANSIENT:timeout";
    const isNetCrash = /TRANSIENT:net::ERR_/.test(lastError.message || "");
    const transient = isTimeout || isNetCrash || isNetworkLikelyDown();
    // Don't blacklist a slug whose positive cache is still fresh — a single
    // 5s cold-TLS timeout is exactly what the poll-hit cache was designed to
    // absorb, and letting the 30s timeout-TTL preempt a recent success would
    // flash false "channel offline" UI on the stream-detail page. Genuine API
    // trouble (DNS / 5xx / parse — the non-transient branch) still locks out.
    if (transient) {
      const fresh = _publicStreamSuccessCache.get(key);
      if (fresh && Date.now() - fresh.timestamp < PUBLIC_STREAM_POLL_HIT_TTL_MS) {
        return null;
      }
    }
    const ttl = transient ? PUBLIC_STREAM_TIMEOUT_TTL_MS : PUBLIC_STREAM_FAILURE_TTL_MS;
    _publicStreamFailureCache.set(key, Date.now() + ttl);
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
      if (!client.isAuthenticated()) {
        // Cannot fetch live details without auth; return null (stream offline from caller perspective)
        return null;
      }
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
/**
 * Fetch streams for a specific Kick category using its SLUG via the
 * private-but-public API. Unlike the global dumps' `category_id` param (which
 * the legacy endpoints silently ignore), this one really filters server-side,
 * so it's the only way to surface non-top-of-platform streams for niche
 * categories when the user isn't logged in.
 *
 * The response uses a different shape than the legacy dumps — ULID-style ids
 * for streams/channels/categories, and stream fields under `metadata`/`streamer`.
 * We map it back into the same `UnifiedStream` shape the rest of the app uses
 * and stamp `categoryId` with the caller's numeric id so downstream identity
 * checks line up with whatever produced that id.
 */
export async function getPublicStreamsByCategorySlug(
  slug: string,
  options: { cursor?: string; numericCategoryId?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const { net } = require("electron");
  const cursorParam = options.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : "";
  const url = `https://api.kick.com/private/v1/categories/${encodeURIComponent(slug)}/livestreams${cursorParam}`;

  const data = await new Promise<any>((resolve) => {
    const request = net.request({ method: "GET", url });
    request.setHeader("Accept", "application/json");
    request.setHeader(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    request.setHeader("Referer", "https://kick.com/");
    request.setHeader("Origin", "https://kick.com");
    request.setHeader("X-Requested-With", "XMLHttpRequest");

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
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }
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

  const livestreams = data?.data?.livestreams || [];
  if (!Array.isArray(livestreams) || livestreams.length === 0) {
    return { data: [] };
  }

  const streams: UnifiedStream[] = livestreams.map((item: any): UnifiedStream => {
    const channel = item.streamer?.channel || {};
    const user = item.streamer?.user || {};
    const meta = item.metadata || {};
    const category = meta.category || {};
    return {
      id: String(item.id || ""),
      platform: "kick",
      channelId: String(channel.id || ""),
      channelName: channel.slug || user.username || "",
      channelDisplayName: user.username || channel.slug || "",
      channelAvatar: user.profile_picture || "",
      title: meta.title || "",
      viewerCount: item.viewers_count ?? 0,
      thumbnailUrl: item.thumbnail_url || "",
      isLive: true,
      startedAt: item.started_at || null,
      language: meta.language || "en",
      tags: Array.isArray(category.tags) ? category.tags : [],
      isMature: !!meta.has_mature_content,
      // Stamp with the originally-requested numeric id (when known) so this
      // matches `categoryId` values seen elsewhere in the app. If the caller
      // didn't supply one, fall back to the response's own (ULID) category id.
      categoryId: options.numericCategoryId || String(category.id || ""),
      categoryName: category.name || "",
    };
  });

  // Only advertise a next cursor if it actually advances. The endpoint
  // sometimes echoes back the same cursor it was given, which would cause
  // useInfiniteQuery to refetch the same page in a loop.
  const nextCursor = data?.data?.next_cursor;
  const advances = nextCursor && nextCursor !== options.cursor;
  return {
    data: streams,
    cursor: advances ? nextCursor : undefined,
  };
}

export async function getPublicTopStreams(
  options: PaginationOptions & { categoryId?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // FAST PATH: if we already know the slug for this numeric category id (from a
  // prior dump call), use the slug-based endpoint which actually filters
  // server-side. The legacy dumps silently ignore their `category_id` param.
  if (options.categoryId) {
    const slug = _categoryIdToSlug.get(options.categoryId);
    if (slug) {
      const result = await getPublicStreamsByCategorySlug(slug, {
        cursor: options.cursor,
        numericCategoryId: options.categoryId,
      });
      if (result.data.length > 0) {
        return result;
      }
      // Slug endpoint returned nothing — fall through to the dump-and-filter
      // path so we at least try the legacy fallback.
    }
  }

  try {
    const { net } = require("electron");
    const language = options.language || "en";

    // Try multiple endpoints — some may be blocked or return limited data.
    // When a categoryId is set, also try category-filtered variants of the
    // global dumps. If the endpoint honors `category_id` we get a real
    // per-category result; if not, the param is silently ignored and we still
    // get the global dump (which we filter client-side downstream).
    const categoryQuery = options.categoryId ? `?category_id=${options.categoryId}` : "";
    const endpoints = options.categoryId
      ? [
          // Category-filtered guesses first (anonymous, web app shape)
          `https://api.kick.com/private/v1/livestreams${categoryQuery}`,
          `https://kick.com/stream/livestreams/${language}${categoryQuery}`,
          `https://kick.com/stream/featured-livestreams/${language}${categoryQuery}`,
          // Plain fallbacks
          `https://api.kick.com/private/v1/livestreams`,
          `https://kick.com/stream/livestreams/${language}`,
        ]
      : [
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
      const categoryName = item.category?.name || item.categories?.[0]?.name || "";
      // Side effect: remember slug so we can use the slug-based category-livestreams
      // endpoint on future calls (it's the only way to get real server-side
      // category filtering for unauthenticated users).
      const categorySlug = item.category?.slug || item.categories?.[0]?.slug || "";
      rememberCategorySlug(categoryId, categorySlug);

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

    // Cold-cache retry: the fast path at the top of this function couldn't
    // find a slug for this category, but parsing the dump above just populated
    // _categoryIdToSlug. If the lookup now succeeds, retry via the slug-based
    // endpoint for real server-side filtering instead of returning whatever
    // happened to be in the global dump.
    if (options.categoryId) {
      const slug = _categoryIdToSlug.get(options.categoryId);
      if (slug) {
        const accurate = await getPublicStreamsByCategorySlug(slug, {
          cursor: options.cursor,
          numericCategoryId: options.categoryId,
        });
        if (accurate.data.length > 0) return accurate;
      }
    }

    // Final fallback: filter the dump client-side (the public endpoints return
    // a global dump and silently ignore category_id, so without this filter
    // we'd return unrelated streams when the caller asked for a specific id).
    let result = streams;
    if (options.categoryId) {
      result = result.filter((s) => s.categoryId === options.categoryId);
    }
    if (options.limit && result.length > options.limit) {
      result = result.slice(0, options.limit);
    }

    return { data: result };
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
  // Offset pagination — `cursor` is the next offset as a string.
  const offsetIn = options.cursor ? parseInt(options.cursor, 10) : 0;
  const safeOffset = Number.isFinite(offsetIn) && offsetIn > 0 ? offsetIn : 0;

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
    if (safeOffset > 0) {
      params.set("offset", safeOffset.toString());
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

    // Return next-offset cursor if the page came back full (more likely exists).
    const requestedLimit = options.limit || 20;
    const nextCursor =
      streams.length >= requestedLimit ? (safeOffset + requestedLimit).toString() : undefined;

    return {
      data: streams,
      cursor: nextCursor,
    };
  } catch (error) {
    // Unauthenticated or API error → use public (no-auth) API.
    // The public fallback doesn't support offset, so we only serve the first
    // page (offset === 0). Subsequent paginated requests return empty so the
    // frontend stops loading further pages cleanly.
    if (safeOffset > 0) {
      return { data: [] };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Not authenticated")) {
      console.debug("[Kick] Falling back to public API for top streams:", message);
    }
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
 *
 * `categoryName` (optional) enables a slug-guess fallback: when the id-based
 * lookup returns no streams, we kebab-case the name and hit the slug-based
 * /private/v1/categories/{slug}/livestreams endpoint directly. This rescues
 * cross-platform browsing where the Kick numeric id wasn't known up-front
 * (e.g. the Twitch→Kick CategoryDetail merge couldn't find a match because the
 * Kick category wasn't in the limited public top-streams dump).
 */
export async function getStreamsByCategory(
  client: KickRequestor,
  categoryId: string,
  options: PaginationOptions & { categoryName?: string; language?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const lang = options.language;
  // The slug endpoint doesn't accept a language param, so we filter the response
  // client-side. Keeps the surface consistent whether the caller passes language or not.
  const filterByLang = (result: PaginatedResult<UnifiedStream>): PaginatedResult<UnifiedStream> =>
    lang ? { ...result, data: result.data.filter((s) => s.language === lang) } : result;

  // No numeric id but we have a name — go straight to the slug-based endpoint.
  // Falling through to getPublicTopStreams with an empty categoryId would
  // bypass its filter and return the global dump (unrelated streams).
  if (!categoryId && options.categoryName) {
    const slug = toKickCategorySlug(options.categoryName);
    if (!slug) return { data: [] };
    const result = await getPublicStreamsByCategorySlug(slug, { cursor: options.cursor });
    return filterByLang(result);
  }

  // The app-token /public/v1/livestreams?category_id=X path that getTopStreams
  // hits always throws for anonymous users, then its catch arm logs a
  // misleading "for top streams" warning, kills pagination at offset > 0, and
  // falls back to getPublicTopStreams. Skip the wasted hop: getPublicTopStreams
  // already resolves the slug and uses /private/v1/categories/{slug}/livestreams
  // (real server-side filter + cursor pagination).
  const primary = client.isAuthenticated()
    ? await getTopStreams(client, { ...options, categoryId })
    : await getPublicTopStreams({ ...options, categoryId });

  if (primary.data.length > 0 || !options.categoryName) {
    return filterByLang(primary);
  }

  // Empty result AND we have a name to guess from — try the slug-based endpoint.
  const slug = toKickCategorySlug(options.categoryName);
  if (!slug) return filterByLang(primary);

  const fallback = await getPublicStreamsByCategorySlug(slug, {
    cursor: options.cursor,
    numericCategoryId: categoryId || undefined,
  });

  if (fallback.data.length === 0) return filterByLang(primary);

  // Cache the resolved slug so subsequent pages take the fast path through
  // getPublicTopStreams without re-guessing.
  if (categoryId) rememberCategorySlug(categoryId, slug);
  return filterByLang(fallback);
}

/**
 * Get followed streams (live channels the user follows)
 * Note: Official API doesn't have a direct followed streams endpoint
 */
export async function getFollowedStreams(
  _client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedStream>> {
  // The official API doesn't have a followed streams endpoint.
  // Callers (the followed-streams IPC handler) union this empty result with
  // local-follow data fetched per-slug via getPublicStreamBySlug — the empty
  // return is the intended contract, not a failure.
  return { data: [] };
}
