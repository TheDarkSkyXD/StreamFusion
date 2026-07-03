import { BrowserWindow } from "electron";
import { logger } from "@/lib/cross-logger";
import { createManagedInterval } from "@/lib/managed-interval";
import { getPlatformHealth } from "../../../unified/platform-health";
import type { KickChatroomSettings, UnifiedChannel } from "../../../unified/platform-types";
import type { KickAuthMode, KickRequestor } from "../kick-requestor";
import { transformKickChannel } from "../kick-transformers";
import { KICK_LEGACY_API_V2_BASE, type KickApiChannel, type KickApiResponse } from "../kick-types";

import { getUsersById } from "./user-endpoints";

/**
 * Map the raw `data.chatroom` block from the Kick v2 channel-resolve payload
 * to the normalized {@link KickChatroomSettings} shape.
 *
 * The raw v2 payload uses **flat** fields:
 *   { followers_mode: bool, subscribers_mode: bool, emotes_mode: bool,
 *     slow_mode: bool, message_interval (seconds), following_min_duration (minutes) }
 *
 * This shape differs from the WS `ChatroomUpdatedEvent` payload, which nests
 * each mode as `{ enabled, message_interval | min_duration }`. We normalize at
 * the boundary so downstream consumers (useChatSettingsSync, InfoBanner) see
 * one shape.
 *
 * Defensive: undefined/missing inputs yield `enabled: false` with null durations.
 * `account_age` is not in the v2 initial-fetch payload (only delivered via WS),
 * so this mapper leaves it absent.
 *
 * Pure function — exported for unit testing without spinning up the BrowserWindow.
 */
export function mapKickChatroomToSettings(raw: unknown): KickChatroomSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const followersEnabled = r.followers_mode === true;
  const followingMinDuration =
    typeof r.following_min_duration === "number" ? r.following_min_duration : null;
  const slowEnabled = r.slow_mode === true;
  const messageInterval = typeof r.message_interval === "number" ? r.message_interval : null;

  return {
    slowMode: {
      enabled: slowEnabled,
      interval: slowEnabled ? messageInterval : null,
    },
    followersMode: {
      enabled: followersEnabled,
      minDuration: followersEnabled ? followingMinDuration : null,
    },
    subscribersMode: { enabled: r.subscribers_mode === true },
    emoteOnlyMode: { enabled: r.emotes_mode === true },
  };
}

// Cache for channel data to reduce API calls and prevent 429 errors
const _channelCache = new Map<string, { channel: UnifiedChannel; timestamp: number }>();
const CHANNEL_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function pickPublicChannelAvatar(
  data: Record<string, unknown>,
  user: Record<string, unknown>
): string {
  return pickString(
    user.profile_pic,
    user.profile_picture,
    user.profileImage,
    data.profile_pic,
    data.profile_picture,
    data.profileImage
  );
}

async function enrichChannelWithKickUser(
  client: KickRequestor,
  channel: UnifiedChannel,
  userId: string | undefined,
  slug: string
): Promise<UnifiedChannel> {
  const userIdNum = userId ? parseInt(userId, 10) : Number.NaN;
  if (Number.isNaN(userIdNum)) {
    return channel;
  }

  try {
    const users = await getUsersById(client, [userIdNum]);
    const user = users.find((candidate) => candidate.user_id.toString() === userId);
    if (!user) {
      return channel;
    }

    return {
      ...channel,
      avatarUrl: user.profile_picture || channel.avatarUrl,
      displayName: user.name || channel.displayName,
    };
  } catch (error) {
    logger.debug("Kick:Endpoints:Channel", "Failed to enrich channel from Kick user", {
      slug,
      userId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return channel;
  }
}

// Periodically clean expired channel cache entries
createManagedInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of _channelCache.entries()) {
      if (now - value.timestamp >= CHANNEL_CACHE_TTL) {
        _channelCache.delete(key);
      }
    }
  },
  1000 * 60 * 5,
  { unref: true }
); // Clean every 5 minutes

/**
 * Get channel info by slug
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug[]=:slug
 *
 * Uses the official app-token API first. Legacy Kick web lookup is only a
 * last-resort compatibility path.
 */
export async function getChannel(
  client: KickRequestor,
  slug: string
): Promise<UnifiedChannel | null> {
  const normalizedSlug = slug.toLowerCase().trim();

  // Check cache first to reduce API calls and avoid 429 errors
  const cached = _channelCache.get(normalizedSlug);
  if (cached && Date.now() - cached.timestamp < CHANNEL_CACHE_TTL) {
    return cached.channel;
  }

  if (!isKickOfficialApiUnavailable()) {
    try {
      const response = await client.request<KickApiResponse<KickApiChannel[]>>(
        `/channels?slug[]=${encodeURIComponent(slug)}`,
        undefined,
        "app"
      );

      if (response.data && response.data.length > 0) {
        const apiChannel = response.data[0];

        // CRITICAL: Multi-field validation to ensure we got the correct channel
        // Check both slug AND that it's not empty/null
        if (!apiChannel.slug || apiChannel.slug.toLowerCase() !== normalizedSlug) {
          logger.debug(
            "Kick:Endpoints:Channel",
            "API identity mismatch; rejecting response (Kick API bug)",
            {
              requestedSlug: slug,
              returnedSlug: apiChannel.slug || "null",
            }
          );
          return null;
        }

        const channel = transformKickChannel(apiChannel);

        // Validate transformed channel data
        if (channel.username.toLowerCase() !== normalizedSlug) {
          logger.warn(
            "Kick:Endpoints:Channel",
            "Post-transform validation failed; channel username does not match requested slug; rejecting",
            {
              channelUsername: channel.username,
              requestedSlug: slug,
            }
          );
          return null;
        }

        const enrichedChannel = await enrichChannelWithKickUser(client, channel, channel.id, slug);

        // Cache successful result
        _channelCache.set(normalizedSlug, {
          channel: enrichedChannel,
          timestamp: Date.now(),
        });

        return enrichedChannel;
      }
    } catch (error) {
      logger.warn("Kick:Endpoints:Channel", "Official channel API failed", {
        slug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  try {
    const publicChannel = await getPublicChannel(slug);
    if (publicChannel) {
      const enrichedChannel = await enrichChannelWithKickUser(
        client,
        publicChannel,
        publicChannel.kickUserId || publicChannel.id,
        slug
      );
      _channelCache.set(normalizedSlug, {
        channel: enrichedChannel,
        timestamp: Date.now(),
      });
      return enrichedChannel;
    }
  } catch (error) {
    logger.warn("Kick:Endpoints:Channel", "Legacy channel lookup failed", {
      slug,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }

  // Both APIs failed
  return null;
}

/**
 * Get multiple channels by their slugs
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug[]=:slug&slug[]=:slug2
 */
export async function getChannelsBySlugs(
  client: KickRequestor,
  slugs: string[]
): Promise<UnifiedChannel[]> {
  if (slugs.length === 0) {
    return [];
  }

  if (isKickOfficialApiUnavailable()) {
    return [];
  }

  try {
    // Max 50 slugs per request
    const limitedSlugs = slugs.slice(0, 50);
    const params = limitedSlugs.map((s) => `slug[]=${encodeURIComponent(s)}`).join("&");

    const response = await client.request<KickApiResponse<KickApiChannel[]>>(
      `/channels?${params}`,
      undefined,
      "app"
    );

    return (response.data || []).map(transformKickChannel);
  } catch (error) {
    const log = isKickAppAuthFailure(error) ? logger.warn : logger.error;
    log("Kick:Endpoints:Channel", "Failed to fetch Kick channels", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}

/**
 * Get multiple channels by stable Kick broadcaster user IDs.
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?broadcaster_user_id[]=:id
 */
export async function getChannelsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[]
): Promise<UnifiedChannel[]> {
  if (broadcasterUserIds.length === 0) {
    return [];
  }

  if (isKickOfficialApiUnavailable()) {
    return [];
  }

  const authModes: KickAuthMode[] = client.isAuthenticated() ? ["user", "app"] : ["app"];
  let lastError: unknown;

  try {
    for (const authMode of authModes) {
      try {
        return await fetchChannelsByBroadcasterIds(client, broadcasterUserIds, authMode);
      } catch (error) {
        lastError = error;
        if (
          authMode === "user" &&
          authModes.includes("app") &&
          shouldRetryBroadcasterIdLookupWithAppAuth(error)
        ) {
          logger.debug(
            "Kick:Endpoints:Channel",
            "User-token broadcaster ID lookup failed; retrying with app auth",
            {
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : String(error),
            }
          );
          continue;
        }

        throw error;
      }
    }
    throw lastError;
  } catch (error) {
    const log = isKickAppAuthFailure(error) ? logger.warn : logger.error;
    log("Kick:Endpoints:Channel", "Failed to fetch Kick channels by broadcaster ID", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}

async function fetchChannelsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[],
  authMode: KickAuthMode
): Promise<UnifiedChannel[]> {
  const channels: UnifiedChannel[] = [];

  // Max 50 IDs per request. The official endpoint rejects mixed slug and
  // broadcaster_user_id parameters, so keep every chunk id-only.
  for (let i = 0; i < broadcasterUserIds.length; i += 50) {
    const ids = broadcasterUserIds.slice(i, i + 50);
    const params = ids
      .map((id) => `broadcaster_user_id[]=${encodeURIComponent(id.toString())}`)
      .join("&");

    const response = await client.request<KickApiResponse<KickApiChannel[]>>(
      `/channels?${params}`,
      undefined,
      authMode
    );

    channels.push(...(response.data || []).map(transformKickChannel));
  }

  return channels;
}

// In-flight dedupe: search fans out 5 concurrent calls per batch, hover prefetch
// + sidebar refetch + channel page open can all race for the same slug. Without
// this every caller spins up its own BrowserWindow.
const _publicChannelInFlight = new Map<string, Promise<UnifiedChannel | null>>();

// Failure-only negative cache. The positive `_channelCache` lives in
// `getChannel`, but direct callers of `getPublicChannel` (search-endpoints,
// search-handlers' verifyAndEnrichKickChannels) bypass it — and nothing was
// caching failures, so a single unreachable slug would re-open a BrowserWindow
// on every hover/refetch.
const _publicChannelFailureCache = new Map<string, number>();
// Warn-once: first failure per slug logs at `warn`, subsequent failures at
// `debug` until a success clears the flag. Keeps repeat-failure spam out of
// the log without hiding the initial signal.
const _publicChannelWarnedSlugs = new Set<string>();
const PUBLIC_CHANNEL_FAILURE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_CHANNEL_LOAD_TIMEOUT_MS = 10000;

function isKickLocallyDown(): boolean {
  return getPlatformHealth("kick") === "down";
}

function isKickOfficialApiUnavailable(): boolean {
  const health = getPlatformHealth("kick");
  return health === "degraded" || health === "down";
}

function isKickAppAuthFailure(error: unknown): boolean {
  return error instanceof Error && /^Kick API error: 401\b/.test(error.message);
}

function shouldRetryBroadcasterIdLookupWithAppAuth(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(Kick API error: 40[13]\b|No Kick user token is available\.)/.test(error.message);
}

// Serialise BrowserWindow creation. Each hidden window spins up a fresh
// Chromium renderer + GPU context — opening 5 at once (search-handlers'
// batch-of-5 verification) is the single largest GPU-load spike under the
// app's control and a likely trigger for the `exit_code=34` GPU crash that
// then drags Chromium's network service down with it. With CHUNK_SIZE=3 in
// followed-streams firing concurrently with a 5-channel search batch, we
// can easily have 8 simultaneous renderer subprocess starts. One at a time
// keeps total memory + GPU pressure flat; the search-verification path that
// previously took ~10s now takes longer per-batch, but search is a rare
// user action and a crash mid-search is far worse for UX than a slower
// result list.
let _browserWindowMutex: Promise<void> = Promise.resolve();
export function acquireBrowserWindowSlot(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = _browserWindowMutex.then(() => release);
  _browserWindowMutex = _browserWindowMutex.then(() => next);
  return wait;
}

/**
 * Get channel info using the public/legacy API (No Auth Required)
 * GET https://kick.com/api/v1/channels/:slug
 *
 * Uses a hidden Electron BrowserWindow to bypass Cloudflare/WAF 403 protections.
 * Concurrent calls for the same slug share an in-flight promise (only one
 * BrowserWindow per slug at a time), and persistent failures are negative-cached
 * for `PUBLIC_CHANNEL_FAILURE_TTL_MS` so the 60s `useFollowedStreams` /
 * channel-hover prefetch loops don't keep re-opening windows for unreachable
 * slugs.
 */
export async function getPublicChannel(slug: string): Promise<UnifiedChannel | null> {
  const key = slug.toLowerCase().trim();

  const failExpiry = _publicChannelFailureCache.get(key);
  if (failExpiry !== undefined) {
    if (Date.now() < failExpiry) return null;
    _publicChannelFailureCache.delete(key);
  }

  const inFlight = _publicChannelInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = _doFetchPublicChannel(slug, key);
  _publicChannelInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    _publicChannelInFlight.delete(key);
  }
}

async function _doFetchPublicChannel(slug: string, key: string): Promise<UnifiedChannel | null> {
  const startedAt = Date.now();
  let queueWaitMs = 0;
  let loadMs: number | undefined;
  let extractMs: number | undefined;

  // Skip the BrowserWindow round-trip if the network service is currently
  // crashed/restarting. loadURL would just time out, and a hidden window is
  // an expensive resource (renderer + GPU + network partition) — exactly the
  // load profile that triggered the cascade in the first place.
  if (isKickLocallyDown()) return null;

  // Wait for our turn so only one hidden BrowserWindow exists at a time.
  // This is the single biggest GPU-load lever in the codebase.
  const queuedAt = Date.now();
  const releaseSlot = await acquireBrowserWindowSlot();
  queueWaitMs = Date.now() - queuedAt;

  // Re-check after acquiring the slot — the network may have crashed while
  // we were queued behind another caller's 10s load timeout.
  if (isKickLocallyDown()) {
    releaseSlot();
    return null;
  }

  let win: BrowserWindow | null = null;
  let failed = true;
  let networkBlip = false;
  try {
    const url = `${KICK_LEGACY_API_V2_BASE}/channels/${slug}`;

    // Create a hidden window
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: "persist:kick_public", // Use a persistent partition to cache Cloudflare tokens
      },
    });

    // Set a timeout for page load
    const loadPromise = win.loadURL(url);
    const timeoutPromise = new Promise<never>((_, reject) =>
      // timer-allowlist: Promise.race nav-timeout on win.loadURL (SP3 out-of-scope)
      setTimeout(() => reject(new Error("Page load timeout")), PUBLIC_CHANNEL_LOAD_TIMEOUT_MS)
    );

    const loadStartedAt = Date.now();
    await Promise.race([loadPromise, timeoutPromise]);
    loadMs = Date.now() - loadStartedAt;

    // Extract JSON content from the page body
    const extractStartedAt = Date.now();
    const pageContent = await win.webContents.executeJavaScript(`
            document.body.innerText;
        `);
    extractMs = Date.now() - extractStartedAt;

    if (!pageContent) {
      logger.warn("Kick:Endpoints:Channel", "Empty response for slug", { slug });
      return null;
    }

    // Check for common HTTP error responses before attempting JSON parse
    const pageContentLower = pageContent.toLowerCase();
    if (
      pageContentLower.includes("error code 5") ||
      pageContentLower.includes("internal server error") ||
      pageContentLower.includes("bad gateway") ||
      pageContentLower.includes("service unavailable")
    ) {
      logger.warn("Kick:Endpoints:Channel", "Server error for slug", {
        slug,
        contentPreview: pageContent.substring(0, 100),
      });
      return null;
    }

    let data: Record<string, any>;
    try {
      data = JSON.parse(pageContent);
    } catch (_e) {
      // Check for Cloudflare challenge or error pages
      const title = win.title;
      if (title.includes("Just a moment") || title.includes("Access denied")) {
        logger.warn("Kick:Endpoints:Channel", "Cloudflare challenge triggered", { slug });
      } else if (pageContent.includes("404")) {
        return null;
      }
      logger.warn("Kick:Endpoints:Channel", "Failed to parse JSON", {
        slug,
        contentPreview: pageContent.substring(0, 100),
      });
      return null;
    }

    if (data.message === "Not found" || data.code === 404) {
      return null;
    }

    // Map the public API response to UnifiedChannel
    const user = data.user || {};

    // Extract the most recent category
    let categoryId: string | undefined;
    let categoryName: string | undefined;

    if (data.recent_categories && data.recent_categories.length > 0) {
      const recentCategory = data.recent_categories[0];
      categoryId = recentCategory?.id?.toString();
      categoryName = recentCategory?.name;
    } else if (data.livestream?.categories && data.livestream.categories.length > 0) {
      const liveCategory = data.livestream.categories[0];
      categoryId = liveCategory?.id?.toString();
      categoryName = liveCategory?.name;
    }

    // Extract the last stream title
    let lastStreamTitle: string | undefined;

    if (data.livestream?.session_title) {
      lastStreamTitle = data.livestream.session_title;
    } else if (data.previous_livestreams && data.previous_livestreams.length > 0) {
      lastStreamTitle = data.previous_livestreams[0]?.session_title;
    }

    // Prefer `data.id` (the channel's internal db id) over `data.user_id`.
    // The two are NOT the same for many Kick channels — `data.id` aligns with
    // the official API's `broadcaster_user_id`, and only it is accepted by the
    // legacy v2 endpoints that key by channel (notably
    // `/api/v2/channels/{id}/messages` and `/api/v2/channels/{id}/livestream`).
    // The previous `data.user_id || data.id` fallback surfaced a different
    // numeric id that silently failed against those endpoints.
    const userId = data.id || data.user_id;
    if (!userId) {
      logger.warn("Kick:Endpoints:Channel", "Missing user_id/id for slug", { slug });
      return null;
    }

    // Extract chatroom ID for Pusher WebSocket subscription
    const chatroomId = data.chatroom?.id;
    const chatroomSettings = mapKickChatroomToSettings(data.chatroom);

    const totalMs = Date.now() - startedAt;
    if (totalMs >= 2000 || queueWaitMs >= 500) {
      logger.info("Kick:Endpoints:Channel", "Public Kick channel lookup slow", {
        slug,
        totalMs,
        queueWaitMs,
        loadMs,
        extractMs,
        hasChatroom: !!data.chatroom,
        isLive: data.livestream !== null,
      });
    }

    failed = false;
    _publicChannelWarnedSlugs.delete(key);
    return {
      id: userId.toString(),
      platform: "kick",
      username: data.slug || slug,
      displayName: user.username || data.slug,
      avatarUrl: pickPublicChannelAvatar(data, user),
      // Try to extract a responsive WebP image from srcset as they may bypass CDN restrictions
      // The srcset contains URLs like: "url1 1200w, url2 1003w, ..."
      // We pick the largest one (first in the list)
      bannerUrl: (() => {
        if (!data.offline_banner_image) return undefined;

        // Try srcset first (responsive WebP images)
        if (data.offline_banner_image.srcset) {
          const srcset = data.offline_banner_image.srcset;
          // Extract first URL from srcset (format: "url 1200w, url2 1003w, ...")
          const firstUrl = srcset.split(",")[0]?.trim().split(" ")[0];
          if (firstUrl) {
            return firstUrl;
          }
        }

        // Fall back to src/url
        return (
          data.offline_banner_image.src ||
          data.offline_banner_image.url ||
          (typeof data.offline_banner_image === "string" ? data.offline_banner_image : undefined)
        );
      })(),
      bio: user.bio || "",
      isLive: data.livestream !== null,
      isVerified: data.verified?.id !== undefined || false,
      isPartner: false, // Can't easily tell from this endpoint
      followerCount: data.followers_count ?? data.followersCount ?? undefined,
      categoryId,
      categoryName,
      lastStreamTitle,
      chatroomId: typeof chatroomId === "number" ? chatroomId : undefined,
      // Keep the broadcaster `user_id` distinct from `id` above (which is the
      // channel/db id). 7TV's KICK connection is keyed by this user_id.
      kickUserId: data.user_id != null ? String(data.user_id) : undefined,
      subscriberBadges: data.subscriber_badges,
      chatroomSettings,
    };
  } catch (error) {
    // If the network service crashed mid-load, the failure isn't this slug's
    // fault — don't penalise it with a 5-minute lockout. Re-check after the
    // failure since the crash event may have fired during loadURL.
    networkBlip = isKickLocallyDown();
    const errorMeta = {
      slug,
      totalMs: Date.now() - startedAt,
      queueWaitMs,
      loadMs,
      extractMs,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    };
    if (_publicChannelWarnedSlugs.has(key) || networkBlip) {
      logger.debug(
        "Kick:Endpoints:Channel",
        "Failed to fetch public Kick channel via Window",
        errorMeta
      );
    } else {
      logger.warn(
        "Kick:Endpoints:Channel",
        "Failed to fetch public Kick channel via Window",
        errorMeta
      );
      _publicChannelWarnedSlugs.add(key);
    }
    return null;
  } finally {
    if (failed && !networkBlip) {
      _publicChannelFailureCache.set(key, Date.now() + PUBLIC_CHANNEL_FAILURE_TTL_MS);
    }
    if (win) {
      try {
        win.destroy();
      } catch (_e) {
        // ignore
      }
    }
    // Release AFTER destroying the window so the next caller starts from a
    // clean slate (Chromium reclaims renderer + GPU before the next opens).
    releaseSlot();
  }
}
