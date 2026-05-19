import { BrowserWindow } from "electron";

import type { KickChatroomSettings, UnifiedChannel } from "../../../unified/platform-types";
import { isNetworkLikelyDown } from "../kick-network-health";
import type { KickRequestor } from "../kick-requestor";
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
  const messageInterval =
    typeof r.message_interval === "number" ? r.message_interval : null;

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

// Periodically clean expired channel cache entries
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of _channelCache.entries()) {
      if (now - value.timestamp >= CHANNEL_CACHE_TTL) {
        _channelCache.delete(key);
      }
    }
  },
  1000 * 60 * 5
).unref(); // Clean every 5 minutes

/**
 * Get channel info by slug
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug[]=:slug
 *
 * ROBUST FIX: Uses public API first to avoid authenticated API identity mismatch bugs
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

  // STRATEGY: Use public API first as it's more reliable and doesn't have identity mismatch bugs
  // The authenticated API has a known bug where it sometimes returns the authenticated user's
  // own channel data instead of the requested channel when using single-slug queries

  try {
    const publicChannel = await getPublicChannel(slug);
    if (publicChannel) {
      // Cache successful result
      _channelCache.set(normalizedSlug, {
        channel: publicChannel,
        timestamp: Date.now(),
      });
      return publicChannel;
    }
  } catch (error) {
    console.warn(`[Kick] Public API failed for channel ${slug}, trying authenticated API:`, error);
  }

  // Fallback to official API only if public API fails
  // This is less likely to be reached, but provides a backup path
  try {
    if (client.isAuthenticated()) {
      const response = await client.request<KickApiResponse<KickApiChannel[]>>(
        `/channels?slug[]=${encodeURIComponent(slug)}`
      );

      if (response.data && response.data.length > 0) {
        const apiChannel = response.data[0];

        // CRITICAL: Multi-field validation to ensure we got the correct channel
        // Check both slug AND that it's not empty/null
        if (!apiChannel.slug || apiChannel.slug.toLowerCase() !== normalizedSlug) {
          console.warn(
            `[Kick] API identity mismatch: requested "${slug}", got "${apiChannel.slug || "null"}". ` +
              `This indicates a Kick API bug. Rejecting response.`
          );
          return null;
        }

        const channel = transformKickChannel(apiChannel);

        // Validate transformed channel data
        if (channel.username.toLowerCase() !== normalizedSlug) {
          console.warn(
            `[Kick] Post-transform validation failed: channel username "${channel.username}" ` +
              `doesn't match requested slug "${slug}". Rejecting.`
          );
          return null;
        }

        // Fetch user info to get avatar and display name
        // Use defensive approach to handle user ID mismatches
        try {
          const channelIdNum = parseInt(channel.id, 10);
          if (Number.isNaN(channelIdNum)) {
            console.warn(`[Kick] Invalid channel ID "${channel.id}" for ${slug}`);
          } else {
            const users = await getUsersById(client, [channelIdNum]);
            if (users.length > 0) {
              const user = users[0];

              // CRITICAL: Triple-check that the user ID matches the channel ID
              // This prevents propagating incorrect user data
              if (user.user_id.toString() === channel.id) {
                if (user.profile_picture) {
                  channel.avatarUrl = user.profile_picture;
                }
                if (user.name) {
                  channel.displayName = user.name;
                }
              } else {
                console.warn(
                  `[Kick] User ID mismatch for channel ${slug}: ` +
                    `fetched user ID ${user.user_id}, expected ${channel.id}. ` +
                    `Skipping user data enrichment.`
                );
              }
            }
          }
        } catch (e) {
          console.debug(`Failed to enrich user info for channel ${slug}:`, e);
          // Not critical - channel data is still valid without user enrichment
        }

        // Cache successful result
        _channelCache.set(normalizedSlug, {
          channel,
          timestamp: Date.now(),
        });

        return channel;
      }
    }
  } catch (error) {
    console.warn(`[Kick] Authenticated API failed for channel ${slug}:`, error);
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

  try {
    // Max 50 slugs per request
    const limitedSlugs = slugs.slice(0, 50);
    const params = limitedSlugs.map((s) => `slug[]=${encodeURIComponent(s)}`).join("&");

    const response = await client.request<KickApiResponse<KickApiChannel[]>>(`/channels?${params}`);

    return (response.data || []).map(transformKickChannel);
  } catch (error) {
    console.error("Failed to fetch Kick channels:", error);
    return [];
  }
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

async function _doFetchPublicChannel(
  slug: string,
  key: string
): Promise<UnifiedChannel | null> {
  // Skip the BrowserWindow round-trip if the network service is currently
  // crashed/restarting. loadURL would just time out, and a hidden window is
  // an expensive resource (renderer + GPU + network partition) — exactly the
  // load profile that triggered the cascade in the first place.
  if (isNetworkLikelyDown()) return null;

  // Wait for our turn so only one hidden BrowserWindow exists at a time.
  // This is the single biggest GPU-load lever in the codebase.
  const releaseSlot = await acquireBrowserWindowSlot();

  // Re-check after acquiring the slot — the network may have crashed while
  // we were queued behind another caller's 10s load timeout.
  if (isNetworkLikelyDown()) {
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
      setTimeout(() => reject(new Error("Page load timeout")), PUBLIC_CHANNEL_LOAD_TIMEOUT_MS)
    );

    await Promise.race([loadPromise, timeoutPromise]);

    // Extract JSON content from the page body
    const pageContent = await win.webContents.executeJavaScript(`
            document.body.innerText;
        `);

    if (!pageContent) {
      console.warn(`[KickChannel] Empty response for ${slug}`);
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
      console.warn(`[KickChannel] Server error for ${slug}: ${pageContent.substring(0, 100)}`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(pageContent);
    } catch (_e) {
      // Check for Cloudflare challenge or error pages
      const title = win.title;
      if (title.includes("Just a moment") || title.includes("Access denied")) {
        console.warn(`[KickChannel] Cloudflare challenge triggered for ${slug}`);
      } else if (pageContent.includes("404")) {
        return null;
      }
      console.warn(
        `[KickChannel] Failed to parse JSON for ${slug}. Content preview: ${pageContent.substring(0, 100)}`
      );
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
      console.warn(`[KickChannel] Missing user_id/id for ${slug}`);
      return null;
    }

    // Extract chatroom ID for Pusher WebSocket subscription
    const chatroomId = data.chatroom?.id;
    const chatroomSettings = mapKickChatroomToSettings(data.chatroom);
    console.debug(`[KickChannel] Extracted for ${slug}:`, {
      userId,
      chatroomId,
      hasChatroom: !!data.chatroom,
      chatroomKeys: data.chatroom ? Object.keys(data.chatroom) : "N/A",
    });

    failed = false;
    _publicChannelWarnedSlugs.delete(key);
    return {
      id: userId.toString(),
      platform: "kick",
      username: data.slug || slug,
      displayName: user.username || data.slug,
      avatarUrl: user.profile_pic || "",
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
      subscriberBadges: data.subscriber_badges,
      chatroomSettings,
    };
  } catch (error) {
    // If the network service crashed mid-load, the failure isn't this slug's
    // fault — don't penalise it with a 5-minute lockout. Re-check after the
    // failure since the crash event may have fired during loadURL.
    networkBlip = isNetworkLikelyDown();
    if (_publicChannelWarnedSlugs.has(key) || networkBlip) {
      console.debug(`Failed to fetch public Kick channel ${slug} via Window:`, error);
    } else {
      console.warn(`Failed to fetch public Kick channel ${slug} via Window:`, error);
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
