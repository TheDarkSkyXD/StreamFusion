import type { BrowserWindow } from "electron";
import { logger } from "@/lib/cross-logger";
import { createManagedInterval } from "@/lib/managed-interval";
import type { ChannelAccountStatus } from "@/shared/channel-account-status-types";
import { getPlatformHealth } from "../../../unified/platform-health";
import type { KickChatroomSettings, UnifiedChannel } from "../../../unified/platform-types";
import type { SubscriberBadge } from "../../../../services/chat/kick-parser";
import type { KickRequestor } from "../kick-requestor";
import { createHiddenKickBrowserWindow } from "../kick-hidden-browser-window";
import { isKickRateLimitError, isKickRequestCancellation } from "../kick-error-classification";
import { requestPublicKickSession } from "../kick-session-request";
import { transformKickChannel } from "../kick-transformers";
import {
  KICK_LEGACY_API_V2_BASE,
  type KickApiChannel,
  type KickApiResponse,
  type KickApiUser,
} from "../kick-types";

import { getUsersById } from "./user-endpoints";
import { getLatestCompletedVideoEndedAtByChannelSlug } from "./video-endpoints";

function mergeKickUserMetadata(channel: UnifiedChannel, user: KickApiUser): UnifiedChannel {
  return {
    ...channel,
    avatarUrl: user.profile_picture || channel.avatarUrl,
    displayName: user.name || channel.displayName,
  };
}

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

/** Map the authoritative nested `/api/v2/channels/:slug/chatroom` snapshot. */
export function mapKickChatroomSnapshotToSettings(raw: unknown): KickChatroomSettings | undefined {
  if (!isRecord(raw)) return undefined;

  const slowMode = readChatroomMode(raw.slow_mode, "message_interval");
  const followersMode = readChatroomMode(raw.followers_mode, "min_duration");
  const subscribersMode = readChatroomMode(raw.subscribers_mode);
  const emoteOnlyMode = readChatroomMode(raw.emotes_mode);
  const accountAge = readChatroomMode(raw.account_age, "min_duration");
  if (!slowMode || !followersMode || !subscribersMode || !emoteOnlyMode || !accountAge) {
    return undefined;
  }

  return {
    slowMode: { enabled: slowMode.enabled, interval: slowMode.duration },
    followersMode: {
      enabled: followersMode.enabled,
      minDuration: followersMode.duration,
    },
    subscribersMode: { enabled: subscribersMode.enabled },
    emoteOnlyMode: { enabled: emoteOnlyMode.enabled },
    accountAge: { enabled: accountAge.enabled, minDuration: accountAge.duration },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readChatroomMode(
  value: unknown,
  durationField?: "message_interval" | "min_duration"
): { enabled: boolean; duration: number | null } | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  const duration = durationField ? value[durationField] : null;
  return {
    enabled: value.enabled,
    duration: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
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

function normalizeFollowerCount(value: unknown): number | undefined {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(count) && count >= 0 ? count : undefined;
}

async function enrichOfflineLastLiveAt(
  channel: UnifiedChannel,
  slug: string
): Promise<UnifiedChannel> {
  if (channel.isLive || channel.lastLiveAt) return channel;

  try {
    const videoEndedAt = await getLatestCompletedVideoEndedAtByChannelSlug(slug);
    return videoEndedAt ? { ...channel, lastLiveAt: videoEndedAt } : channel;
  } catch (error) {
    logger.debug(
      "Kick:Endpoints:Channel",
      "Completed VOD last-live fallback failed; keeping channel metadata",
      {
        slug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }
    );
    return channel;
  }
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

  if (isKickOfficialApiUnavailable() && !client.isAuthenticated()) {
    return channel;
  }

  try {
    const users = await getUsersById(client, [userIdNum]);
    const user = users.find((candidate) => candidate.user_id.toString() === userId);
    if (!user) {
      return channel;
    }

    return mergeKickUserMetadata(channel, user);
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

function isExplicitKickNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const record = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  if (record.status === 404 || record.statusCode === 404 || record.response?.status === 404) {
    return true;
  }

  const message = typeof record.message === "string" ? record.message : "";
  return /(?:\b404\b|not[ _-]?found)/i.test(message);
}

/**
 * Preserve the authority boundary for account removal. A successful response
 * without the requested row is ambiguous; only an explicit provider not-found
 * error is destructive evidence.
 */
export async function getOfficialKickChannelAccountStatus(
  client: KickRequestor,
  slug: string
): Promise<Exclude<ChannelAccountStatus, "suspended"> | "not_found"> {
  if (!client.isAuthenticated()) {
    return "unavailable";
  }

  const normalizedSlug = slug.trim().toLowerCase();
  try {
    const response = await client.request<KickApiResponse<KickApiChannel[]>>(
      `/channels?slug=${encodeURIComponent(normalizedSlug)}`
    );
    const exactChannel = Array.isArray(response?.data)
      ? response.data.find((channel) => channel?.slug?.trim().toLowerCase() === normalizedSlug)
      : undefined;
    return exactChannel ? "active" : "unavailable";
  } catch (error) {
    return isExplicitKickNotFound(error) ? "not_found" : "unavailable";
  }
}

/**
 * Get channel info by slug
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug=:slug
 *
 * Uses the signed-in user's token for the official API. Signed-out reads use
 * the legacy Kick web lookup.
 */
export async function getChannel(
  client: KickRequestor,
  slug: string,
  options: { freshChatroomSettings?: boolean } = {}
): Promise<UnifiedChannel | null> {
  const normalizedSlug = slug.toLowerCase().trim();

  // Check cache first to reduce API calls and avoid 429 errors
  const cached = _channelCache.get(normalizedSlug);
  if (
    !options.freshChatroomSettings &&
    cached &&
    Date.now() - cached.timestamp < CHANNEL_CACHE_TTL
  ) {
    return cached.channel;
  }

  if (client.isAuthenticated() && !isKickOfficialApiUnavailable()) {
    try {
      const response = await client.request<KickApiResponse<KickApiChannel[]>>(
        `/channels?slug=${encodeURIComponent(normalizedSlug)}`
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

        let enrichedChannel = await enrichChannelWithKickUser(client, channel, channel.id, slug);

        // The official channel response is authoritative for identity and live
        // state, but it does not expose chatroom metadata. Kick chat cannot
        // connect without the legacy v2 chatroom id, so hydrate live channels
        // as well as offline channels without replacing official identity.
        if (
          options.freshChatroomSettings ||
          !enrichedChannel.isLive ||
          !enrichedChannel.chatroomId
        ) {
          try {
            const publicChannel = await getPublicChannel(slug, { priority: "high" });
            if (publicChannel?.username.toLowerCase() === normalizedSlug) {
              enrichedChannel = {
                ...enrichedChannel,
                avatarUrl: publicChannel.avatarUrl || enrichedChannel.avatarUrl,
                displayName: publicChannel.displayName || enrichedChannel.displayName,
                followerCount: publicChannel.followerCount ?? enrichedChannel.followerCount,
                lastLiveAt: publicChannel.lastLiveAt ?? enrichedChannel.lastLiveAt,
                chatroomId: publicChannel.chatroomId ?? enrichedChannel.chatroomId,
                kickChannelId: publicChannel.kickChannelId ?? enrichedChannel.kickChannelId,
                subscriberBadges:
                  publicChannel.subscriberBadges ?? enrichedChannel.subscriberBadges,
                chatroomSettings:
                  publicChannel.chatroomSettings ?? enrichedChannel.chatroomSettings,
              };
            }
          } catch (error) {
            logger.debug(
              "Kick:Endpoints:Channel",
              "Legacy channel metadata enrichment failed; keeping official channel",
              {
                slug,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
              }
            );
          }
        }

        if (!enrichedChannel.isLive) {
          enrichedChannel = await enrichOfflineLastLiveAt(enrichedChannel, slug);
        }

        // Cache successful result
        _channelCache.set(normalizedSlug, {
          channel: enrichedChannel,
          timestamp: Date.now(),
        });

        return enrichedChannel;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const log =
        isKickRequestCancellation(message) || isKickRateLimitError(error)
          ? logger.debug
          : logger.warn;
      log("Kick:Endpoints:Channel", "Official channel API failed", {
        slug,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  try {
    const publicChannel = await getPublicChannel(slug, { priority: "high" });
    if (publicChannel) {
      let enrichedChannel = await enrichChannelWithKickUser(
        client,
        publicChannel,
        publicChannel.kickUserId || publicChannel.id,
        slug
      );
      enrichedChannel = await enrichOfflineLastLiveAt(enrichedChannel, slug);
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
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug=:slug&slug=:slug2
 */
export async function getChannelsBySlugs(
  client: KickRequestor,
  slugs: string[]
): Promise<UnifiedChannel[]> {
  if (slugs.length === 0) {
    return [];
  }

  if (!client.isAuthenticated() || isKickOfficialApiUnavailable()) {
    return [];
  }

  try {
    // Max 50 slugs per request
    const limitedSlugs = slugs.slice(0, 50);
    const params = limitedSlugs.map((s) => `slug=${encodeURIComponent(s)}`).join("&");

    const response = await client.request<KickApiResponse<KickApiChannel[]>>(`/channels?${params}`);

    const requestedSlugs = new Set(limitedSlugs.map((slug) => slug.trim().toLowerCase()));
    const channels = (response.data || [])
      .filter((channel) => requestedSlugs.has(channel.slug.trim().toLowerCase()))
      .map(transformKickChannel);
    return await enrichChannelsWithKickUsers(client, channels);
  } catch (error) {
    if (isKickRateLimitError(error)) throw error;
    const log = getKickChannelFailureLogger(error);
    log("Kick:Endpoints:Channel", "Failed to fetch Kick channels", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return [];
  }
}

const broadcasterChannelRequests = new WeakMap<
  KickRequestor,
  Map<string, Promise<UnifiedChannel[]>>
>();

/**
 * Get multiple channels by stable Kick broadcaster user IDs.
 * https://docs.kick.com/apis/channels - GET /public/v1/channels?broadcaster_user_id=:id
 */
export async function getChannelsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[]
): Promise<UnifiedChannel[]> {
  if (broadcasterUserIds.length === 0) {
    return [];
  }

  if (!client.isAuthenticated() || isKickOfficialApiUnavailable()) {
    return [];
  }

  const requestKey = Array.from(new Set(broadcasterUserIds))
    .sort((left, right) => left - right)
    .join(",");
  let clientRequests = broadcasterChannelRequests.get(client);
  if (!clientRequests) {
    clientRequests = new Map();
    broadcasterChannelRequests.set(client, clientRequests);
  }

  const existingRequest = clientRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const channels = await fetchChannelsByBroadcasterIds(client, broadcasterUserIds);
      return await enrichChannelsWithKickUsers(client, channels);
    } catch (error) {
      const log = getKickChannelFailureLogger(error);
      log("Kick:Endpoints:Channel", "Failed to fetch Kick channels by broadcaster ID", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return [];
    }
  })();
  clientRequests.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (clientRequests.get(requestKey) === request) clientRequests.delete(requestKey);
  }
}

async function enrichChannelsWithKickUsers(
  client: KickRequestor,
  channels: UnifiedChannel[]
): Promise<UnifiedChannel[]> {
  const userIds = Array.from(
    new Set(
      channels
        .map((channel) => Number(channel.kickUserId ?? channel.id))
        .filter((userId) => Number.isSafeInteger(userId))
    )
  );
  if (userIds.length === 0) {
    return channels;
  }

  try {
    const users = await getUsersById(client, userIds);
    const usersById = new Map(users.map((user) => [user.user_id, user]));

    return channels.map((channel) => {
      const user = usersById.get(Number(channel.kickUserId ?? channel.id));
      return user ? mergeKickUserMetadata(channel, user) : channel;
    });
  } catch (error) {
    logger.debug("Kick:Endpoints:Channel", "Failed to enrich Kick channels from users", {
      userIds,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return channels;
  }
}

const KICK_CHANNEL_BATCH_SIZE = 20;
const KICK_CHANNEL_FALLBACK_BATCH_SIZE = 10;

async function fetchChannelsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[]
): Promise<UnifiedChannel[]> {
  const channels: UnifiedChannel[] = [];

  for (let i = 0; i < broadcasterUserIds.length; i += KICK_CHANNEL_BATCH_SIZE) {
    const ids = broadcasterUserIds.slice(i, i + KICK_CHANNEL_BATCH_SIZE);

    try {
      channels.push(...(await requestChannelsByBroadcasterIds(client, ids)));
    } catch (error) {
      if (!isKickServerError(error) || ids.length <= KICK_CHANNEL_FALLBACK_BATCH_SIZE) {
        throw error;
      }

      logger.debug(
        "Kick:Endpoints:Channel",
        "Kick broadcaster batch failed; retrying once with smaller batches",
        { batchSize: ids.length }
      );

      for (
        let fallbackIndex = 0;
        fallbackIndex < ids.length;
        fallbackIndex += KICK_CHANNEL_FALLBACK_BATCH_SIZE
      ) {
        const fallbackIds = ids.slice(
          fallbackIndex,
          fallbackIndex + KICK_CHANNEL_FALLBACK_BATCH_SIZE
        );
        try {
          channels.push(...(await requestChannelsByBroadcasterIds(client, fallbackIds)));
        } catch (fallbackError) {
          if (!isKickServerError(fallbackError)) {
            throw fallbackError;
          }
          logger.debug("Kick:Endpoints:Channel", "Skipping failed smaller broadcaster batch", {
            batchSize: fallbackIds.length,
          });
        }
      }
    }
  }

  return channels;
}

async function requestChannelsByBroadcasterIds(
  client: KickRequestor,
  broadcasterUserIds: number[]
): Promise<UnifiedChannel[]> {
  // The official endpoint rejects mixed slug and broadcaster_user_id
  // parameters, so every request remains ID-only.
  const params = broadcasterUserIds
    .map((id) => `broadcaster_user_id=${encodeURIComponent(id.toString())}`)
    .join("&");
  const response = await client.request<KickApiResponse<KickApiChannel[]>>(`/channels?${params}`);
  const requestedIds = new Set(broadcasterUserIds);

  return (response.data || [])
    .filter((channel) => requestedIds.has(channel.broadcaster_user_id))
    .map(transformKickChannel);
}

function isKickServerError(error: unknown): boolean {
  if (error instanceof Error && /(?:Kick API error:\s*)?5\d\d\b/.test(error.message)) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const directStatus = (error as { status?: unknown }).status;
  const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
  const status = typeof directStatus === "number" ? directStatus : responseStatus;
  return typeof status === "number" && status >= 500 && status < 600;
}

// In-flight dedupe: search fans out 5 concurrent calls per batch, hover prefetch
// + sidebar refetch + channel page open can all race for the same slug. Without
// this every caller spins up its own BrowserWindow.
type BrowserWindowPriority = "high" | "normal";
type PublicChannelInFlight = {
  promise: Promise<UnifiedChannel | null>;
  priority: BrowserWindowPriority;
};
const _publicChannelInFlight = new Map<string, PublicChannelInFlight>();

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

function isKickOfficialAuthFailure(error: unknown): boolean {
  return error instanceof Error && /^Kick API error: 401\b/.test(error.message);
}

function getKickChannelFailureLogger(error: unknown): typeof logger.debug {
  const message = error instanceof Error ? error.message : String(error);
  if (isKickRequestCancellation(message) || isKickRateLimitError(error)) return logger.debug;
  return isKickOfficialAuthFailure(error) ? logger.warn : logger.error;
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
let _browserWindowSlotActive = false;
const _browserWindowQueues: Record<BrowserWindowPriority, Array<(release: () => void) => void>> = {
  high: [],
  normal: [],
};

function dispatchBrowserWindowSlot(): void {
  if (_browserWindowSlotActive) return;
  const next = _browserWindowQueues.high.shift() ?? _browserWindowQueues.normal.shift();
  if (!next) return;

  _browserWindowSlotActive = true;
  let released = false;
  next(() => {
    if (released) return;
    released = true;
    _browserWindowSlotActive = false;
    dispatchBrowserWindowSlot();
  });
}

export function acquireBrowserWindowSlot(
  priority: BrowserWindowPriority = "normal",
  timeoutMs?: number
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queued = (release: () => void) => {
      if (timer) clearTimeout(timer);
      resolve(release);
    };
    _browserWindowQueues[priority].push(queued);
    if (timeoutMs !== undefined) {
      // timer-allowlist: removes abandoned hidden-window work from the shared queue.
      timer = setTimeout(() => {
        const index = _browserWindowQueues[priority].indexOf(queued);
        if (index < 0) return;
        _browserWindowQueues[priority].splice(index, 1);
        reject(new Error("browser-window-slot-timeout"));
      }, timeoutMs);
    }
    dispatchBrowserWindowSlot();
  });
}

/**
 * Get channel info using the public/legacy API (No Auth Required)
 * GET https://kick.com/api/v2/channels/:slug
 *
 * Uses the persistent Electron session directly, with a hidden BrowserWindow
 * fallback for Cloudflare/WAF challenges that require page runtime state.
 * Same-priority calls for a slug share an in-flight promise. An interactive
 * request may bypass a queued background lookup for that slug. Persistent
 * failures are negative-cached so polling does not repeatedly open windows for
 * unreachable slugs.
 */
export async function getPublicChannel(
  slug: string,
  options: { priority?: BrowserWindowPriority } = {}
): Promise<UnifiedChannel | null> {
  const key = slug.toLowerCase().trim();
  const priority = options.priority ?? "normal";

  const failExpiry = _publicChannelFailureCache.get(key);
  if (failExpiry !== undefined) {
    if (Date.now() < failExpiry) return null;
    _publicChannelFailureCache.delete(key);
  }

  const inFlight = _publicChannelInFlight.get(key);
  if (inFlight && (priority === "normal" || inFlight.priority === "high")) {
    return inFlight.promise;
  }

  const promise = _doFetchPublicChannel(slug, key, priority);
  if (!inFlight) _publicChannelInFlight.set(key, { promise, priority });
  try {
    return await promise;
  } finally {
    if (_publicChannelInFlight.get(key)?.promise === promise) {
      _publicChannelInFlight.delete(key);
    }
  }
}

async function _doFetchPublicChannel(
  slug: string,
  key: string,
  priority: BrowserWindowPriority
): Promise<UnifiedChannel | null> {
  const startedAt = Date.now();
  let queueWaitMs = 0;
  let loadMs: number | undefined;
  let extractMs: number | undefined;

  // Skip the BrowserWindow round-trip if the network service is currently
  // crashed/restarting. loadURL would just time out, and a hidden window is
  // an expensive resource (renderer + GPU + network partition) — exactly the
  // load profile that triggered the cascade in the first place.
  if (isKickLocallyDown()) return null;

  let releaseSlot: (() => void) | null = null;
  let win: BrowserWindow | null = null;
  let failed = true;
  let networkBlip = false;
  try {
    const channelPath = `/api/v2/channels/${encodeURIComponent(slug)}`;
    let pageContent: string | undefined;
    let parsed: unknown;

    const directResponse = await requestPublicKickSession(channelPath);
    if (directResponse.kind === "response" && directResponse.ok) {
      try {
        const candidate: unknown = JSON.parse(directResponse.body);
        if (isResolvedPublicChannelPayload(candidate)) {
          parsed = candidate;
          pageContent = directResponse.body;
        }
      } catch {
        // A successful HTML/challenge response is retried in page context below.
      }
    } else if (
      directResponse.kind === "response" &&
      ![401, 403, 419].includes(directResponse.status)
    ) {
      return null;
    }

    if (!isPublicChannelPayload(parsed)) {
      const queuedAt = Date.now();
      releaseSlot = await acquireBrowserWindowSlot(priority);
      queueWaitMs = Date.now() - queuedAt;
      if (isKickLocallyDown()) return null;

      const url = `${KICK_LEGACY_API_V2_BASE}/channels/${encodeURIComponent(slug.trim())}`;
      win = createHiddenKickBrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: "persist:kick_public",
        },
      });

      const loadPromise = win.loadURL(url);
      const timeoutPromise = new Promise<never>((_, reject) =>
        // timer-allowlist: Promise.race nav-timeout on win.loadURL (SP3 out-of-scope)
        setTimeout(() => reject(new Error("Page load timeout")), PUBLIC_CHANNEL_LOAD_TIMEOUT_MS)
      );

      const loadStartedAt = Date.now();
      await Promise.race([loadPromise, timeoutPromise]);
      loadMs = Date.now() - loadStartedAt;

      const extractStartedAt = Date.now();
      const extracted: unknown = await win.webContents.executeJavaScript(
        "document.body.innerText;"
      );
      extractMs = Date.now() - extractStartedAt;
      pageContent = typeof extracted === "string" ? extracted : undefined;
    }

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

    if (!isPublicChannelPayload(parsed)) {
      try {
        parsed = JSON.parse(pageContent);
      } catch (_e) {
        // Check for Cloudflare challenge or error pages
        const title = win?.title ?? "";
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
    }

    if (!isPublicChannelPayload(parsed)) {
      logger.warn("Kick:Endpoints:Channel", "Public channel payload did not match expected shape", {
        slug,
      });
      return null;
    }
    const data = parsed;

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

    // Preserve this legacy resolver's existing generic identity while also
    // exposing each Kick ID domain explicitly below.
    const userId = data.id || data.user_id;
    if (!userId) {
      logger.warn("Kick:Endpoints:Channel", "Missing user_id/id for slug", { slug });
      return null;
    }

    // Extract chatroom ID for Pusher WebSocket subscription
    const chatroomId = data.chatroom?.id;
    const chatroomSettings = win
      ? await fetchKickChatroomSettings(win, slug)
      : ((await fetchKickChatroomSettingsDirect(slug)) ?? mapKickChatroomToSettings(data.chatroom));

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
      displayName: user.username || data.slug || slug,
      avatarUrl: pickPublicChannelAvatar(data, user),
      // Try to extract a responsive WebP image from srcset as they may bypass CDN restrictions
      // The srcset contains URLs like: "url1 1200w, url2 1003w, ..."
      // We pick the largest one (first in the list)
      bannerUrl: (() => {
        if (!data.offline_banner_image) return undefined;

        // Try srcset first (responsive WebP images)
        if (typeof data.offline_banner_image === "object" && data.offline_banner_image.srcset) {
          const srcset = data.offline_banner_image.srcset;
          // Extract first URL from srcset (format: "url 1200w, url2 1003w, ...")
          const firstUrl = srcset.split(",")[0]?.trim().split(" ")[0];
          if (firstUrl) {
            return firstUrl;
          }
        }

        // Fall back to src/url
        return (
          (typeof data.offline_banner_image === "object"
            ? data.offline_banner_image.src
            : undefined) ||
          (typeof data.offline_banner_image === "object"
            ? data.offline_banner_image.url
            : undefined) ||
          (typeof data.offline_banner_image === "string" ? data.offline_banner_image : undefined)
        );
      })(),
      bio: user.bio || "",
      isLive: data.livestream !== null,
      isVerified: data.verified?.id !== undefined || false,
      isPartner: false, // Can't easily tell from this endpoint
      followerCount: normalizeFollowerCount(data.followers_count ?? data.followersCount),
      categoryId,
      categoryName,
      lastStreamTitle,
      chatroomId: typeof chatroomId === "number" ? chatroomId : undefined,
      kickChannelId:
        data.id != null
          ? String(data.id)
          : typeof chatroomId === "number"
            ? String(chatroomId)
            : undefined,
      // 7TV's KICK connection is keyed by the broadcaster user ID.
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
      logger.debug("Kick:Endpoints:Channel", "Failed to fetch public Kick channel", errorMeta);
    } else {
      logger.warn("Kick:Endpoints:Channel", "Failed to fetch public Kick channel", errorMeta);
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
    releaseSlot?.();
  }
}

async function fetchKickChatroomSettingsDirect(
  slug: string
): Promise<KickChatroomSettings | undefined> {
  const endpoint = `/api/v2/channels/${encodeURIComponent(slug.trim().toLowerCase())}/chatroom`;
  const response = await requestPublicKickSession(endpoint);
  if (response.kind !== "response" || !response.ok || !response.body) return undefined;
  try {
    const parsed: unknown = JSON.parse(response.body);
    return mapKickChatroomSnapshotToSettings(parsed);
  } catch {
    return undefined;
  }
}

async function fetchKickChatroomSettings(
  win: BrowserWindow,
  slug: string
): Promise<KickChatroomSettings | undefined> {
  const endpoint = JSON.stringify(
    `/api/v2/channels/${encodeURIComponent(slug.trim().toLowerCase())}/chatroom`
  );
  try {
    const pageContent: unknown = await win.webContents.executeJavaScript(`
      (async () => {
        const response = await fetch(${endpoint}, {
          credentials: "include",
          headers: { Accept: "application/json" }
        });
        return response.ok ? response.text() : null;
      })();
    `);
    if (typeof pageContent !== "string" || !pageContent) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(pageContent);
    } catch {
      return undefined;
    }
    return mapKickChatroomSnapshotToSettings(parsed);
  } catch (error) {
    logger.debug("Kick:Endpoints:Channel", "Authoritative chatroom settings fetch unavailable", {
      slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

interface PublicChannelPayload extends Record<string, unknown> {
  message?: string;
  code?: number;
  id?: string | number;
  user_id?: string | number;
  slug?: string;
  user?: Record<string, unknown> & { username?: string; bio?: string };
  recent_categories?: Array<{ id?: string | number; name?: string }>;
  livestream?: null | {
    categories?: Array<{ id?: string | number; name?: string }>;
    session_title?: string;
  };
  previous_livestreams?: Array<{ session_title?: string }>;
  chatroom?: Record<string, unknown> & { id?: number };
  offline_banner_image?: string | { srcset?: string; src?: string; url?: string };
  verified?: { id?: string | number };
  followers_count?: string | number;
  followersCount?: string | number;
  subscriber_badges?: SubscriberBadge[];
}

function isPublicChannelPayload(value: unknown): value is PublicChannelPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value;
  const validIdentity =
    (!("id" in payload) || typeof payload.id === "string" || typeof payload.id === "number") &&
    (!("user_id" in payload) ||
      typeof payload.user_id === "string" ||
      typeof payload.user_id === "number");
  const validUser =
    !("user" in payload) ||
    payload.user === undefined ||
    (typeof payload.user === "object" && payload.user !== null);
  const validBadges =
    !("subscriber_badges" in payload) ||
    payload.subscriber_badges === undefined ||
    Array.isArray(payload.subscriber_badges);
  return validIdentity && validUser && validBadges;
}

function isResolvedPublicChannelPayload(value: unknown): value is PublicChannelPayload {
  if (!isPublicChannelPayload(value)) return false;
  return (
    value.id !== undefined ||
    value.user_id !== undefined ||
    value.message === "Not found" ||
    value.code === 404
  );
}
