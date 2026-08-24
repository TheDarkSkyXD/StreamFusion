import { net } from "electron";
import { logger } from "@/backend/logging/logger";
import { createManagedInterval } from "@/lib/managed-interval";
import { sleep } from "@/lib/sleep";
import {
  getPlatformHealth,
  isPlatformHealthy,
  recordPlatformFailure,
  recordPlatformLocalNetError,
  recordPlatformSuccess,
} from "../../../unified/platform-health";
import type { UnifiedChannel, UnifiedStream } from "../../../unified/platform-types";
import { acquireKickRequestSlot } from "../kick-network-health";
import { rememberKickLivePlaybackFromChannelPayload } from "../kick-playback-cache";
import type { KickRequestor } from "../kick-requestor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface PrivateLivestream {
  id?: string;
  viewers_count?: number;
  thumbnail_url?: string;
  started_at?: string;
  streamer?: { channel?: { id?: string; slug?: string }; user?: { username?: string; profile_picture?: string } };
  metadata?: { title?: string; language?: string; has_mature_content?: boolean; category?: { id?: string; name?: string; tags?: string[] } };
}

interface LegacyChannelPayload {
  slug: string;
  user?: { username?: string; profile_picture?: string; profile_pic?: string; profilepic?: string };
  livestream: null | {
    id: string | number;
    channel_id: string | number;
    session_title?: string;
    viewer_count?: number;
    viewers?: number;
    thumbnail?: { url?: string };
    start_time?: string;
    created_at?: string;
    language?: string;
    custom_tags?: string[];
    tags?: string[];
    is_mature?: boolean;
    categories?: Array<{ id?: string | number; name?: string }>;
  };
}

function isLegacyChannelPayload(value: unknown): value is LegacyChannelPayload {
  if (!isRecord(value) || typeof value.slug !== "string" || !("livestream" in value)) return false;
  return value.livestream === null || isRecord(value.livestream);
}

function isPrivateLivestream(value: unknown): value is PrivateLivestream {
  return isRecord(value);
}

interface DirectoryNode {
  id?: string | number;
  slug?: string;
  name?: string;
  username?: string;
  user_id?: string | number;
  profile_picture?: string;
  profile_pic?: string;
  profilepic?: string;
  url?: string;
  src?: string;
  thumbnail_url?: string;
  title?: string;
  language?: string;
  has_mature_content?: boolean;
  user?: DirectoryNode;
  channel?: DirectoryNode;
  category?: DirectoryNode;
  thumbnail?: DirectoryNode;
}

interface DirectoryLivestream extends DirectoryNode {
  streamer?: DirectoryNode;
  metadata?: DirectoryNode;
  livestream?: DirectoryNode;
  categories?: DirectoryNode[];
  session_id?: string | number;
  channel_id?: string | number;
  category_id?: string | number;
  broadcaster_user_id?: string | number;
  broadcaster_username?: string;
  broadcaster_display_name?: string;
  broadcaster_name?: string;
  session_title?: string;
  viewers_count?: number;
  viewer_count?: number;
  viewers?: number;
  started_at?: string;
  created_at?: string;
  start_time?: string;
  custom_tags?: string[];
  tags?: string[];
  is_mature?: boolean;
  has_mature_content?: boolean;
}

function isDirectoryLivestream(value: unknown): value is DirectoryLivestream {
  return isRecord(value);
}
import {
  normalizeKickDate,
  transformKickLivestream,
  transformKickUserLivestream,
} from "../kick-transformers";
import {
  KICK_LEGACY_API_V1_BASE,
  type KickApiLivestream,
  type KickApiResponse,
  type KickApiUser,
  type KickApiUserLivestream,
  type PaginatedResult,
  type PaginationOptions,
} from "../kick-types";
import { getChannelsBySlugs } from "./channel-endpoints";
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
function toKickCategorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// Cache for display name lookups to avoid redundant requests
const _displayNameCache = new Map<
  string,
  { displayName: string; avatar: string; isVerified: boolean; timestamp: number }
>();
const DISPLAY_NAME_CACHE_TTL = 1000 * 60 * 60; // 60 minutes — streamer renames are rare, fewer net.request fallbacks
const MAX_CACHE_SIZE = 1000; // Limit cache to 1000 entries

// Periodically clean expired entries to prevent memory leaks
// Using unref so the interval doesn't prevent graceful shutdown
createManagedInterval(
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
  1000 * 60 * 5,
  { unref: true }
); // Clean every 5 minutes

/**
 * Lightweight function to fetch just display name and avatar for a channel
 * Uses net.request (fast) instead of BrowserWindow (slow)
 */
async function getChannelDisplayInfo(
  slug: string
): Promise<{ displayName: string; avatar: string; isVerified: boolean } | null> {
  // Check cache first
  const cached = _displayNameCache.get(slug.toLowerCase());
  if (cached && Date.now() - cached.timestamp < DISPLAY_NAME_CACHE_TTL) {
    return {
      displayName: cached.displayName,
      avatar: cached.avatar,
      isVerified: cached.isVerified,
    };
  }

  // Skip the round-trip during a known outage — the call has no retries and
  // would just return null, leaving displayName as the lowercase slug forever
  // in callers. Returning null here lets the next refetch try fresh.
  if (!isPlatformHealthy("kick")) return null;

  const releaseSlot = await acquireKickRequestSlot();
  try {
    const { net } = require("electron");

    let data: unknown = null;
    try {
      const res: Response = await net.fetch(`${KICK_LEGACY_API_V1_BASE}/channels/${slug}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://kick.com/",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        data = await res.json().catch(() => null);
      }
    } catch {
      // timeout or network error
    }

    if (!isRecord(data)) return null;

    // Prefer official API field (profile_picture) over legacy (profile_pic)
    // Official API returns kick.com/img/... URLs which work directly
    // Legacy API returns files.kick.com/... URLs which may return 403
    const channelUser = isRecord(data.user) ? data.user : {};
    const result = {
      displayName: typeof channelUser.username === "string" ? channelUser.username : slug,
      avatar: [channelUser.profile_picture, channelUser.profile_pic, channelUser.profilepic].find((value): value is string => typeof value === "string") || "",
      isVerified: isKickChannelVerified(data),
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

function isKickChannelVerified(data: unknown): boolean {
  if (!isRecord(data)) return false;
  const user = isRecord(data.user) ? data.user : {};
  const streamer = isRecord(data.streamer) ? data.streamer : {};
  const streamerUser = isRecord(streamer.user) ? streamer.user : {};
  const verified = isRecord(data.verified) ? data.verified.id : data.verified;
  const userVerified = isRecord(user.verified) ? user.verified.id : user.verified;
  const streamerVerified = isRecord(streamerUser.verified) ? streamerUser.verified.id : streamerUser.verified;
  return !!(
    verified ?? data.is_verified ?? userVerified ?? user.is_verified ?? streamerVerified ?? streamerUser.is_verified ??
    false
  );
}

function createOfflineStreamEvidence(channel: UnifiedChannel): UnifiedStream {
  return {
    id: `offline:${channel.id}`,
    platform: "kick",
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: channel.avatarUrl,
    channelIsVerified: channel.isVerified || channel.isPartner,
    title: channel.lastStreamTitle || "",
    viewerCount: 0,
    thumbnailUrl: "",
    isLive: false,
    startedAt: null,
    language: "en",
    tags: [],
    categoryId: channel.categoryId,
    categoryName: channel.categoryName,
  };
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

// Last-known-good cache. Consulted when platform health is unhealthy (the
// Chromium network service just crashed) — we'd otherwise return null and the
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
const LIVE_METADATA_RECOVERY_CONCURRENCY = 4;

const CIRCUIT_PROBE_INTERVAL_MS = 5_000;
let _lastProbeTimestamp = 0;

export function __resetCircuitProbeForTests(): void {
  _lastProbeTimestamp = 0;
}

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
    const timeoutId = setTimeout(resolve, ms); // timer-allowlist: staggerDelay cancellable helper — needs a backend createManagedTimeout primitive (out of SP3 scope)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("AbortError"));
      },
      { once: true }
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
  options: { cacheMode?: "default" | "refresh" } = {}
): Promise<UnifiedStream | null> {
  const key = slug.toLowerCase().trim();

  // Circuit-open: when Kick is unhealthy (degraded or down), shed traffic to
  // serve last-known-good cache. `down` sheds ALL requests (no probes; the
  // network is crashed). `degraded` allows periodic probes to feed recovery.
  if (!isPlatformHealthy("kick")) {
    const health = getPlatformHealth("kick");
    if (health === "down") {
      const cached = _publicStreamSuccessCache.get(key);
      if (cached && Date.now() - cached.timestamp < PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
        return cached.data;
      }
    } else {
      // degraded — probe behavior (existing circuit-open logic)
      const now = Date.now();
      const isProbe = now - _lastProbeTimestamp >= CIRCUIT_PROBE_INTERVAL_MS;
      if (isProbe) {
        _lastProbeTimestamp = now;
      } else {
        const cached = _publicStreamSuccessCache.get(key);
        if (cached && Date.now() - cached.timestamp < PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
          return cached.data;
        }
      }
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
  // re-bursting for offline follows. Active-channel checks may bypass this
  // window so an offline-to-live transition is visible on the next UI poll.
  const cachedSuccess = _publicStreamSuccessCache.get(key);
  if (
    options.cacheMode !== "refresh" &&
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
    if (result === null && !isPlatformHealthy("kick")) {
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

/**
 * Recover live metadata omitted by Kick's official API from the legacy channel
 * payload, but only when channel identity and live-session start both match.
 */
async function recoverKickLiveMetadata(
  stream: UnifiedStream,
  recoverMissingThumbnail: boolean
): Promise<UnifiedStream> {
  const needsViewerCount = stream.viewerCount === 0;
  const needsThumbnail = recoverMissingThumbnail && !stream.thumbnailUrl.trim();
  if (!stream.isLive || (!needsViewerCount && !needsThumbnail)) return stream;

  try {
    const fallback = await getPublicStreamBySlug(stream.channelName);
    const sameChannel =
      fallback?.platform === "kick" &&
      fallback.isLive &&
      fallback.channelName.trim().toLowerCase() === stream.channelName.trim().toLowerCase();
    const officialStartedAt = stream.startedAt ? Date.parse(stream.startedAt) : Number.NaN;
    const fallbackStartedAt = fallback?.startedAt ? Date.parse(fallback.startedAt) : Number.NaN;
    const sameLiveSession =
      Number.isFinite(officialStartedAt) &&
      Number.isFinite(fallbackStartedAt) &&
      officialStartedAt === fallbackStartedAt;
    if (sameChannel && sameLiveSession) {
      return {
        ...stream,
        viewerCount:
          needsViewerCount && Number.isFinite(fallback.viewerCount) && fallback.viewerCount > 0
            ? fallback.viewerCount
            : stream.viewerCount,
        thumbnailUrl:
          needsThumbnail && fallback.thumbnailUrl.trim()
            ? fallback.thumbnailUrl
            : stream.thumbnailUrl,
      };
    }
  } catch (error) {
    logger.debug("Kick:Endpoints:Stream", "Legacy live-metadata recovery failed", {
      channelName: stream.channelName,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }

  return stream;
}

async function recoverKickLiveMetadataBatch(
  streams: UnifiedStream[],
  options: { recoverMissingThumbnails?: boolean } = {}
): Promise<UnifiedStream[]> {
  const recovered = [...streams];
  const candidates = streams
    .map((stream, index) => ({ stream, index }))
    .filter(
      ({ stream }) =>
        stream.platform === "kick" &&
        stream.isLive &&
        (stream.viewerCount === 0 ||
          (options.recoverMissingThumbnails && !stream.thumbnailUrl.trim()))
    );

  for (let offset = 0; offset < candidates.length; offset += LIVE_METADATA_RECOVERY_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + LIVE_METADATA_RECOVERY_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(({ stream }) =>
        recoverKickLiveMetadata(stream, options.recoverMissingThumbnails === true)
      )
    );
    batch.forEach(({ index }, batchIndex) => {
      recovered[index] = batchResults[batchIndex];
    });
  }

  return recovered;
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
    // Only bail for `down` (local crash); `degraded` (high failure rate)
    // allows probe requests through to feed the recovery evaluator.
    if (getPlatformHealth("kick") === "down") {
      lastError = new Error("TRANSIENT:timeout");
      break;
    }

    const releaseSlot = await acquireKickRequestSlot();
    try {
      // Without a timeout, hung connections wait for Chromium's TCP timeout
      // (~21s) before surfacing as ERR_CONNECTION_TIMED_OUT. Fail fast so the
      // 60s refetch cycle doesn't stack up.
      const res: Response = await net.fetch(`${KICK_LEGACY_API_V1_BASE}/channels/${slug}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://kick.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(PUBLIC_STREAM_REQUEST_TIMEOUT_MS),
      });

      // Transient server errors - should retry
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(`TRANSIENT:${res.status}`);
      }

      if (res.status !== 200 && res.status !== 404) {
        throw new Error(`Status ${res.status}`);
      }

      let data: unknown = null;
      if (res.status !== 404) {
        try {
          data = await res.json();
        } catch (_e) {
          logger.warn("Kick:Endpoints:Stream", "Failed to parse JSON", { slug });
          throw new Error("Failed to parse JSON");
        }
      }

      // API responded successfully — clear any prior warn flag for this slug
      // so a future failure will warn again instead of being silently debug-ed.
      _publicStreamWarnedSlugs.delete(key);
      // 200 and 404 both count as a healthy round-trip to platform-health;
      // 404 means the channel doesn't exist, not that Kick is down.
      recordPlatformSuccess("kick");

      if (!isLegacyChannelPayload(data)) return null;

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
        channelIsVerified: isKickChannelVerified(data),
        title: livestream.session_title || "",
        viewerCount: livestream.viewer_count ?? livestream.viewers ?? 0,
        thumbnailUrl: livestream.thumbnail?.url || "",
        isLive: true,
        startedAt: normalizeKickDate(livestream.start_time ?? livestream.created_at),
        language: livestream.language || "en",
        tags:
          livestream.custom_tags && livestream.custom_tags.length > 0
            ? livestream.custom_tags
            : livestream.tags || [],
        isMature: livestream.is_mature ?? false,
        categoryId: livestream.categories?.[0]?.id?.toString() || "",
        categoryName: livestream.categories?.[0]?.name || "",
      };
      rememberKickLivePlaybackFromChannelPayload(key, data);
      _publicStreamSuccessCache.set(key, { data: result, timestamp: Date.now() });
      return result;
    } catch (error: unknown) {
      // Normalize TimeoutError/AbortError from AbortSignal.timeout and raw
      // network errors (net::ERR_*) from net.fetch into the TRANSIENT: prefix
      // so the retry/classification logic below is unchanged.
      let normalizedError: Error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        normalizedError = new Error("TRANSIENT:timeout");
      } else if (
        error instanceof Error &&
        !error.message.startsWith("TRANSIENT:") &&
        !error.message.startsWith("Status ") &&
        error.message !== "Failed to parse JSON"
      ) {
        normalizedError = new Error(`TRANSIENT:${error.message}`);
      } else {
        normalizedError = error instanceof Error ? error : new Error(String(error));
      }
      lastError = normalizedError;

      // Check if this is a transient error that should be retried
      if (normalizedError.message?.startsWith("TRANSIENT:")) {
        const reason = normalizedError.message.split(":")[1];
        // Feed net::ERR_* failures into the health tracker so a burst across
        // concurrent slugs flips the global flag and the remaining retries
        // (here and at other Kick call sites) bail out fast.
        if (/net::ERR_/.test(normalizedError.message)) {
          recordPlatformLocalNetError("kick");
        }
        // Map TRANSIENT shapes onto PlatformFailureClass. Excluded shapes
        // (Status N / parse) take the non-transient break above and never
        // reach this branch.
        if (normalizedError.message === "TRANSIENT:timeout") {
          recordPlatformFailure("kick", "timeout");
        } else if (/^TRANSIENT:net::ERR_/.test(normalizedError.message)) {
          recordPlatformFailure("kick", "net-error");
        } else {
          // TRANSIENT:502 | 503 | 504.
          recordPlatformFailure("kick", "server-5xx");
        }
        if (getPlatformHealth("kick") === "down") break;
        // Don't delay after the final attempt
        if (attempt < maxRetries - 1) {
          // Jitter ±25% so concurrent slugs don't all retry at the same
          // millisecond and form a synchronised thundering-herd against
          // Kick's edge.
          const base = 1000 * 2 ** attempt; // 1s, 2s, 4s
          const jitter = base * (0.75 + Math.random() * 0.5);
          const backoffMs = Math.round(jitter);
          logger.debug("Kick:Endpoints:Stream", "Transient error; retrying", {
            reason,
            slug,
            backoffMs,
            attempt: attempt + 1,
            maxRetries,
          });
          await sleep(backoffMs);
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
    const errorMeta = {
      slug,
      error: { name: lastError.name, message: lastError.message, stack: lastError.stack },
    };
    const isDegraded = !isPlatformHealthy("kick");
    if (isDegraded || _publicStreamWarnedSlugs.has(key)) {
      logger.debug("Kick:Endpoints:Stream", "Failed to fetch public Kick stream", errorMeta);
    } else {
      logger.warn("Kick:Endpoints:Stream", "Failed to fetch public Kick stream", errorMeta);
      _publicStreamWarnedSlugs.add(key);
    }
    // Short TTL for timeouts and known network-service outages (transient,
    // process-level — not the slug's fault); long TTL for everything else
    // (DNS, 5xx, parse errors — Kick is genuinely unhappy).
    const isTimeout = lastError.message === "TRANSIENT:timeout";
    const isNetCrash = /TRANSIENT:net::ERR_/.test(lastError.message || "");
    const transient = isTimeout || isNetCrash || !isPlatformHealthy("kick");
    // Transient failures are not proof that a followed stream went offline.
    // Serve the last successful state (live or offline) inside the outage stale
    // window so a flaky refresh does not replace a visible Kick follow with
    // null. Genuine offline transitions still come from successful responses
    // above (`livestream === null`), which update this cache to null.
    if (transient) {
      const stale = _publicStreamSuccessCache.get(key);
      if (stale && Date.now() - stale.timestamp < PUBLIC_STREAM_OUTAGE_STALE_TTL_MS) {
        return stale.data;
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
 * Uses the official Kick API live-status path first, with the legacy kick.com
 * channel payload as a compatibility fallback for no-auth/API-degraded cases.
 */
export async function getStreamBySlug(
  client: KickRequestor,
  slug: string,
  options: { freshStatus?: boolean } = {}
): Promise<UnifiedStream | null> {
  const normalizedSlug = slug.toLowerCase().trim();

  try {
    const channel = (await getChannelsBySlugs(client, [slug])).find(
      (candidate) => candidate.username.toLowerCase() === normalizedSlug
    );

    // Validate channel matches requested slug
    if (channel && channel.username.toLowerCase() !== normalizedSlug) {
      logger.warn(
        "Kick:Endpoints:Stream",
        "Channel lookup mismatch; rejecting to prevent identity confusion",
        {
          requestedSlug: slug,
          returnedUsername: channel.username,
        }
      );
      return null;
    }

    if (channel?.isLive) {
      try {
        const channelIdNum = parseInt(channel.id, 10);
        if (Number.isNaN(channelIdNum)) {
          logger.warn("Kick:Endpoints:Stream", "Invalid channel ID for stream; trying legacy", {
            channelId: channel.id,
            slug,
          });
          throw new Error("Invalid channel ID for stream");
        }

        const stream = (await getStreamsByBroadcasterIds(client, [channelIdNum])).find(
          (candidate) => candidate.channelId === channel.id
        );

        if (stream) {
          if (stream.channelName.toLowerCase() !== normalizedSlug) {
            logger.warn("Kick:Endpoints:Stream", "Stream channel name mismatch; rejecting", {
              requestedSlug: slug,
              returnedChannelName: stream.channelName,
            });
            return null;
          }

          // Use channel display name if available and better than what we have
          if (channel.displayName && channel.displayName !== channel.username) {
            stream.channelDisplayName = channel.displayName;
          }
          if (channel.avatarUrl) {
            stream.channelAvatar = channel.avatarUrl;
          }

          return stream;
        }
      } catch (error) {
        logger.warn("Kick:Endpoints:Stream", "Official stream details failed; trying legacy", {
          slug,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    } else if (channel) {
      return createOfflineStreamEvidence(channel);
    }
  } catch (e) {
    logger.warn("Kick:Endpoints:Stream", "Official stream API failed; trying legacy", {
      slug,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
    });
  }

  try {
    const publicStream = await getPublicStreamBySlug(
      slug,
      0,
      undefined,
      options.freshStatus ? { cacheMode: "refresh" } : undefined
    );
    if (!publicStream) return null;

    if (publicStream.channelName.toLowerCase() === normalizedSlug) {
      return publicStream;
    }

    logger.warn("Kick:Endpoints:Stream", "Public stream API mismatch; rejecting", {
      requestedSlug: slug,
      returnedChannelName: publicStream.channelName,
    });
  } catch (e) {
    logger.debug("Kick:Endpoints:Stream", "Legacy public stream API failed", {
      slug,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
    });
  }

  return null;
}

/**
 * Get live streams by stable Kick broadcaster user IDs.
 * GET /public/v1/users/livestreams?user_id=:id
 *
 * The deprecated `/public/v1/livestreams` endpoint returned 500 for valid
 * 50-ID requests in production. The replacement accepts up to 100 user IDs,
 * keeping typical followed-stream refreshes to one bounded bulk request.
 */
export async function getStreamsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[]
): Promise<UnifiedStream[]> {
  if (!client.isAuthenticated()) return [];

  const uniqueIds = [
    ...new Set(broadcasterUserIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
  ];
  if (uniqueIds.length === 0) return [];

  const streams: UnifiedStream[] = [];

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const ids = uniqueIds.slice(i, i + 100);
    const params = new URLSearchParams();
    for (const id of ids) {
      params.append("user_id", id.toString());
    }

    const response = await client.request<KickApiResponse<KickApiUserLivestream[]>>(
      `/users/livestreams?${params.toString()}`
    );
    const requested = new Set(ids);

    for (const apiStream of response.data || []) {
      if (!requested.has(apiStream.broadcaster_user.id)) {
        logger.warn("Kick:Endpoints:Stream", "Ignoring livestream with unexpected broadcaster ID", {
          requestedIds: ids,
          returnedBroadcasterId: apiStream.broadcaster_user.id,
        });
        continue;
      }
      streams.push(transformKickUserLivestream(apiStream));
    }
  }

  return recoverKickLiveMetadataBatch(streams, { recoverMissingThumbnails: true });
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
async function getPublicStreamsByCategorySlug(
  slug: string,
  options: { cursor?: string; numericCategoryId?: string } = {}
): Promise<PaginatedResult<UnifiedStream>> {
  const { net } = require("electron");
  const cursorParam = options.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : "";
  const url = `https://api.kick.com/private/v1/categories/${encodeURIComponent(slug)}/livestreams${cursorParam}`;

  let data: unknown = null;
  try {
    const res: Response = await net.fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://kick.com/",
        Origin: "https://kick.com",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      data = await res.json().catch(() => null);
    }
  } catch {
    // timeout or network error
  }

  const responseData = isRecord(data) && isRecord(data.data) ? data.data : null;
  const livestreams = responseData && Array.isArray(responseData.livestreams)
    ? responseData.livestreams.filter(isPrivateLivestream)
    : [];
  if (!Array.isArray(livestreams) || livestreams.length === 0) {
    return { data: [] };
  }

  const streams: UnifiedStream[] = livestreams.map((item): UnifiedStream => {
    const channel = item.streamer?.channel ?? {};
    const user = item.streamer?.user ?? {};
    const meta = item.metadata ?? {};
    const category = meta.category ?? {};
    return {
      id: String(item.id || ""),
      platform: "kick",
      channelId: String(channel.id || ""),
      channelName: channel.slug || user.username || "",
      channelDisplayName: user.username || channel.slug || "",
      channelAvatar: user.profile_picture || "",
      channelIsVerified: isKickChannelVerified(item),
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
  const nextCursor = responseData && typeof responseData.next_cursor === "string" ? responseData.next_cursor : undefined;
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
    const language = options.language || "en";

    // Try multiple endpoints — some may be blocked or return limited data.
    // When a categoryId is set, also try category-filtered variants of the
    // global dumps. If the endpoint honors `category_id` we get a real
    // per-category result; if not, the param is silently ignored and we still
    // get the global dump (which we filter client-side downstream).
    const queryParams = new URLSearchParams();
    if (options.categoryId) queryParams.set("category_id", options.categoryId);
    if (options.cursor) queryParams.set("cursor", options.cursor);
    const queryString = queryParams.toString();
    const categoryQuery = queryString ? `?${queryString}` : "";
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
          `https://api.kick.com/private/v1/livestreams${categoryQuery}`,
          `https://kick.com/stream/livestreams/${language}`,
          `https://kick.com/stream/featured-livestreams/${language}`,
        ];

    let bestData: unknown = null;
    let bestCount = 0;

    for (const url of endpoints) {
      try {
        let data: unknown = null;
        try {
          const res: Response = await net.fetch(url, {
            headers: {
              Accept: "application/json",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://kick.com/",
              Origin: "https://kick.com",
              "X-Requested-With": "XMLHttpRequest",
            },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            data = await res.json().catch(() => null);
          }
        } catch {
          // timeout or network error — try next endpoint
        }

        if (data) {
          const dataRecord = isRecord(data) ? data : null;
          const nestedData = dataRecord && isRecord(dataRecord.data) ? dataRecord.data : null;
          const rawList: unknown[] = Array.isArray(data)
            ? data
            : dataRecord && Array.isArray(dataRecord.data)
              ? dataRecord.data
              : nestedData && Array.isArray(nestedData.livestreams)
                ? nestedData.livestreams
                : dataRecord && Array.isArray(dataRecord.livestreams) ? dataRecord.livestreams : [];

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
    const bestRecord = isRecord(bestData) ? bestData : null;
    const bestNested = bestRecord && isRecord(bestRecord.data) ? bestRecord.data : null;
    const rawList: unknown[] = Array.isArray(bestData)
      ? bestData
      : bestRecord && Array.isArray(bestRecord.data)
        ? bestRecord.data
        : bestNested && Array.isArray(bestNested.livestreams)
          ? bestNested.livestreams
          : bestRecord && Array.isArray(bestRecord.livestreams) ? bestRecord.livestreams : [];
    const nextCursor =
      (bestNested && typeof bestNested.next_cursor === "string" ? bestNested.next_cursor : undefined) ||
      (bestRecord && typeof bestRecord.next_cursor === "string" ? bestRecord.next_cursor : undefined);

    for (const item of rawList) {
      if (!isDirectoryLivestream(item)) continue;
      // Basic validation - handle different response structures
      // IMPORTANT: Prefer channel slug fields (the actual channel slug like "xqc")
      // over item.slug which is the LIVESTREAM slug (UUID-prefixed, e.g., "f084f107-atl-w-...")
      // The legacy endpoint kick.com/stream/livestreams/en returns item.slug as a livestream slug.
      const slug =
        item.streamer?.channel?.slug ||
        item.channel?.slug ||
        item.broadcaster_username ||
        item.slug;
      if (!item || !slug) continue;

      // Extract thumbnail URL - different endpoints use different field structures
      const thumbnailUrl =
        item.thumbnail?.url ||
        item.thumbnail?.src ||
        item.thumbnail_url ||
        item.metadata?.thumbnail_url ||
        (typeof item.thumbnail === "string" ? item.thumbnail : "") ||
        item.livestream?.thumbnail?.url ||
        "";

      // Extract avatar URL - different endpoints use different field structures
      // IMPORTANT: Prefer official API field (profile_picture) over legacy (profilepic/profile_pic)
      // Official API returns kick.com/img/... URLs which work directly
      // Legacy API returns files.kick.com/... URLs which may return 403 but still useful as fallback
      const avatarUrl =
        item.streamer?.user?.profile_picture ||
        item.profile_picture || // Official API field (kick.com/img/... - works!)
        item.user?.profile_picture ||
        item.channel?.user?.profile_picture ||
        item.channel?.user?.profilepic || // Legacy API field (no underscore!)
        item.user?.profile_pic || // Legacy API field (files.kick.com - may 403)
        item.channel?.user?.profile_pic ||
        "";

      // Extract category - legacy endpoint nests categories in an array
      const categoryId = (
        item.metadata?.category?.id ||
        item.category_id ||
        item.category?.id ||
        item.categories?.[0]?.id ||
        ""
      ).toString();
      const categoryName =
        item.metadata?.category?.name || item.category?.name || item.categories?.[0]?.name || "";
      // Side effect: remember slug so we can use the slug-based category-livestreams
      // endpoint on future calls (it's the only way to get real server-side
      // category filtering for unauthenticated users).
      const categorySlug =
        item.metadata?.category?.slug || item.category?.slug || item.categories?.[0]?.slug || "";
      rememberCategorySlug(categoryId, categorySlug);

      streams.push({
        id: (item.id || item.session_id || "").toString(),
        platform: "kick",
        channelId: (
          item.channel?.id ||
          item.streamer?.channel?.id ||
          item.streamer?.user?.id ||
          item.channel_id ||
          item.broadcaster_user_id ||
          item.channel?.user_id ||
          item.user_id ||
          ""
        ).toString(),
        channelName: slug,
        channelDisplayName:
          item.streamer?.user?.username ||
          item.channel?.user?.username ||
          item.user?.username ||
          item.broadcaster_display_name ||
          item.broadcaster_name ||
          item.broadcaster_username ||
          slug,
        channelAvatar: avatarUrl,
        channelIsVerified: isKickChannelVerified(item),
        title: item.metadata?.title || item.session_title || item.title || "",
        viewerCount: item.viewers_count ?? item.viewer_count ?? item.viewers ?? 0,
        thumbnailUrl: thumbnailUrl,
        isLive: true,
        startedAt: normalizeKickDate(item.started_at || item.created_at || item.start_time),
        language: item.metadata?.language || item.language || language,
        tags: item.custom_tags && item.custom_tags.length > 0 ? item.custom_tags : item.tags || [],
        isMature:
          item.metadata?.has_mature_content ?? item.is_mature ?? item.has_mature_content ?? false,
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

    return {
      data: result,
      cursor: nextCursor && nextCursor !== options.cursor ? String(nextCursor) : undefined,
    };
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

  if (!client.isAuthenticated()) {
    return safeOffset > 0 ? { data: [] } : getPublicTopStreams(options);
  }

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
    const userIds = rawStreams.map((s) => s.broadcaster_user_id);

    let userMap = new Map<number, KickApiUser>();
    try {
      // Only fetch if we have streams
      if (userIds.length > 0) {
        const users = await getUsersById(client, userIds);
        userMap = new Map(users.map((u) => [u.user_id, u]));
      }
    } catch (e) {
      logger.warn("Kick:Endpoints:Stream", "Failed to fetch user avatars for streams", {
        error:
          e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      });
    }

    const streams = await recoverKickLiveMetadataBatch(
      rawStreams.map((s) => {
        const stream = transformKickLivestream(s);
        const user = userMap.get(s.broadcaster_user_id);
        if (user) {
          if (user.profile_picture) {
            stream.channelAvatar = user.profile_picture;
          }
          if (user.name) {
            stream.channelDisplayName = user.name;
          }
          stream.channelIsVerified ||= isKickChannelVerified(user);
        }
        return stream;
      })
    );

    // If we couldn't enrich with user data (unauthenticated or rate limited),
    // the display names will still be lowercase slugs.
    // Fetch individual channel data which has properly capitalized display names.
    if (userMap.size === 0 && streams.length > 0) {
      try {
        // Get unique slugs that need enrichment
        const uniqueSlugs = [...new Set(streams.map((s) => s.channelName))];

        // Fetch channel data in small batches to avoid rate limiting (429)
        // Reduced from 15 to 3 concurrent requests with delay between batches
        const displayNameMap = new Map<
          string,
          { displayName: string; avatar: string; isVerified: boolean }
        >();
        const batchSize = 3; // Reduced from 15 to avoid 429 rate limits
        const batchDelayMs = 200; // Add delay between batches

        for (let i = 0; i < uniqueSlugs.length; i += batchSize) {
          // Add delay between batches (not before first batch)
          if (i > 0) {
            await sleep(batchDelayMs);
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
                isVerified: result.isVerified,
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
            stream.channelIsVerified ||= data.isVerified;
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
      logger.debug("Kick:Endpoints:Stream", "Falling back to public API for top streams", {
        message,
      });
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
        logger.warn("Kick:Endpoints:Stream", "Official API top streams failed, trying fallback");
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
    logger.warn("Kick:Endpoints:Stream", "Failed to refresh top streams cache", {
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
    });
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

export function clearKickStreamFailureCache(): void {
  _publicStreamFailureCache.clear();
  _publicStreamWarnedSlugs.clear();
}
