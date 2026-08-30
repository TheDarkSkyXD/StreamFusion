/**
 * Kick API Client
 *
 * Client for interacting with the official Kick Public API v1.
 * API Documentation: https://docs.kick.com/
 *
 * Handles authentication and data fetching for stream discovery.
 */

import { logger } from "@backend/logging/logger";
import {
  readResponseTextWithinLimit,
  ResponseBodyTooLargeError,
} from "@backend/reliability/bounded-response-body";
import { sleep } from "@shared/utils/sleep";
import { session } from "electron";
import type { KickUser, Platform } from "../../../../shared/auth-types";
import { kickAuthService } from "../../../auth/kick-auth";
import {
  purgeStoredThirdPartyCookies,
  registerThirdPartyCookieStripper,
} from "../../../services/third-party-cookie-stripper";
import type { IPlatformReader, PageResult, TopStreamsOptions } from "../../unified/platform-reader";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedStream,
} from "../../../../shared/platform-types";
import { clients } from "../../unified/registry";

// Re-export common types for compatibility
export type { PaginatedResult, PaginationOptions } from "./kick-types";

import { isPlatformHealthy, recordPlatformLocalNetError } from "../../unified/platform-health";
// Import endpoints
import * as CategoryEndpoints from "./endpoints/category-endpoints";
import * as ChannelEndpoints from "./endpoints/channel-endpoints";
import * as ClipEndpoints from "./endpoints/clip-endpoints";
import * as FollowEndpoints from "./endpoints/follow-endpoints";
import * as SearchEndpoints from "./endpoints/search-endpoints";
import * as StreamEndpoints from "./endpoints/stream-endpoints";
import * as UserEndpoints from "./endpoints/user-endpoints";
import * as VideoEndpoints from "./endpoints/video-endpoints";
import { isKickNetworkFailure, isKickRequestCancellation } from "./kick-error-classification";
import { acquireKickRequestSlot } from "./kick-network-health";
import { KickRateLimitError, kickRateLimitGuard } from "./kick-rate-limit-guard";
import type { KickRequestor } from "./kick-requestor";
import {
  KICK_API_BASE,
  type KickApiUser,
  type PaginatedResult,
  type PaginationOptions,
} from "./kick-types";

// ========== Global Rate Limiter ==========
// Prevents 429 Too Many Requests by limiting request rate

class KickRateLimiter {
  private requestQueue: Array<{
    resolve: () => void;
    timestamp: number;
  }> = [];
  private lastRequestTime = 0;
  private processing = false;

  // Minimum delay between requests (ms) - 200ms = max 5 requests/second
  private readonly minDelay = 200;

  /**
   * Wait for rate limit slot before making request
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest >= this.minDelay) {
      // Enough time has passed, can proceed immediately
      this.lastRequestTime = now;
      return;
    }

    // Need to wait
    return new Promise<void>((resolve) => {
      this.requestQueue.push({ resolve, timestamp: now });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minDelay - timeSinceLastRequest);

      if (waitTime > 0) {
        await sleep(waitTime);
      }

      const next = this.requestQueue.shift();
      if (next) {
        this.lastRequestTime = Date.now();
        next.resolve();
      }
    }

    this.processing = false;
  }
}

// Singleton rate limiter for all Kick API requests
const kickRateLimiter = new KickRateLimiter();

// ========== Image fetch dedupe + negative cache ==========
// Renderer often double-fetches the same URL (StrictMode, remounts, two cards
// for the same VOD), so we share the in-flight promise across concurrent calls.
// Kick's S3-backed CDN returns AccessDenied for purged VOD thumbnails — those
// URLs will never succeed, so we negative-cache 4xx responses to skip the round
// trip on re-renders. Transient errors (timeouts, network) stay uncached.
export interface KickImageBytes {
  buffer: Buffer;
  contentType: string;
}

const _imageInFlight = new Map<string, Promise<KickImageBytes | null>>();
const _imageNegativeCache = new Map<string, number>();
const _IMAGE_NEG_CACHE_TTL_MS = 10 * 60 * 1000;

// ========== Kick API Client Class ==========

class KickClient implements KickRequestor, IPlatformReader {
  readonly platform: Platform = "kick";
  readonly baseUrl = KICK_API_BASE;

  /**
   * Make an authenticated request to the official Kick Public API v1
   * All official endpoints require OAuth2 Bearer token
   */
  /**
   * Make an HTTP request using Electron's net module
   * Uses Chromium's networking stack which handles IPv6-only domains (like api.kick.com) properly
   */
  /**
   * Make an HTTP request using Electron's net module
   * Uses Chromium's networking stack which handles IPv6-only domains (like api.kick.com) properly
   */
  private async electronRequest<T>(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
    callerSignal?: AbortSignal
  ): Promise<{ data: T; statusCode: number; responseHeaders: Record<string, string> }> {
    // Cap concurrent Kick net.fetch calls so authenticated traffic can't
    // pile on top of the public-API fetches (followed-streams refresh, display
    // name enrichment, image proxy) and oversubscribe the network service.
    const releaseSlot = await acquireKickRequestSlot();
    try {
      const { net } = require("electron");

      const timeoutSignal = AbortSignal.timeout(15000);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
      const res: Response = await net.fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        signal,
      });

      // Collect response headers
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      let responseBody: string;
      try {
        responseBody = await readResponseTextWithinLimit(res, 2_000_000);
      } catch (error) {
        if (error instanceof ResponseBodyTooLargeError) {
          throw new Error("Kick API response exceeded the size limit");
        }
        throw error;
      }
      let data: T;
      try {
        data = responseBody ? (JSON.parse(responseBody) as T) : (null as T);
      } catch (_e) {
        if (res.ok) throw new Error("Failed to parse Kick API JSON response");
        data = null as T;
      }

      return { data, statusCode: res.status, responseHeaders };
    } finally {
      releaseSlot();
    }
  }

  // Lazy-initialized direct session for CDN requests (bypasses proxy)
  private cdnSession: Electron.Session | null = null;
  private cdnSessionInitialization: Promise<Electron.Session> | null = null;

  /**
   * Get or create a session configured for direct CDN access (no proxy)
   * This prevents 403 errors from proxy interference
   */
  private async getCdnSession(): Promise<Electron.Session> {
    if (this.cdnSession) {
      return this.cdnSession;
    }

    if (this.cdnSessionInitialization) {
      return this.cdnSessionInitialization;
    }

    this.cdnSessionInitialization = (async () => {
      // Create dedicated session for CDN requests with no proxy
      const cdnSession: Electron.Session = session.fromPartition("persist:kick-cdn-direct");

      // Configure to bypass all proxies for CDN domains
      await cdnSession.setProxy({
        mode: "direct", // Bypass all proxy settings
      });

      // Close any existing connections to ensure new settings take effect
      await cdnSession.closeAllConnections();

      // The CDN partition has its own cookie jar, so the default-session
      // stripper doesn't reach it. Wire the same strip + purge here so Kick
      // CDN responses don't pollute this jar either.
      registerThirdPartyCookieStripper(cdnSession);
      void purgeStoredThirdPartyCookies(cdnSession).catch(() => {
        // Best-effort; cookie eviction is not gating CDN reads.
      });

      // Cache the session
      this.cdnSession = cdnSession;

      return cdnSession;
    })();

    try {
      return await this.cdnSessionInitialization;
    } catch (error) {
      this.cdnSessionInitialization = null;
      throw error;
    }
  }

  /**
   * Make a binary HTTP request using Electron's net module (for images)
   * Uses a dedicated session with direct connection to bypass proxy and avoid 403 errors
   */
  private async electronRequestBinary(
    url: string,
    headers: Record<string, string>,
    timeoutMs = 15000
  ): Promise<{ buffer: Buffer; statusCode: number; contentType: string }> {
    // Get direct session to bypass proxy
    const directSession = await this.getCdnSession();

    // A grid of channel cards on the discover page can fire 20-50 image
    // proxy requests simultaneously. Share the same global slot so they
    // can't fully starve API traffic.
    const releaseSlot = await acquireKickRequestSlot();
    try {
      // Use the CDN session's own fetch so the direct-proxy setting applies;
      // useSessionCookies is implicitly false because we don't pass credentials.
      const res: Response = await directSession.fetch(url, {
        headers,
        credentials: "omit", // Don't send cookies to avoid 403 errors
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const contentType = res.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return { buffer, statusCode: res.status, contentType };
    } finally {
      releaseSlot();
    }
  }

  /**
   * Fetch an image provided a URL and return the raw bytes + content type.
   * Uses the same network stack and headers as other Kick requests.
   * Used by the kick-image:// protocol handler to stream bytes back to the
   * renderer without the ~33% inflation of base64 data-URL encoding.
   */
  async fetchImageBytes(url: string): Promise<KickImageBytes | null> {
    const negExpiry = _imageNegativeCache.get(url);
    if (negExpiry !== undefined) {
      if (Date.now() < negExpiry) {
        return null;
      }
      _imageNegativeCache.delete(url);
    }

    // Image fetches deliberately bypass the platform health gate. The gate is
    // designed for retry loops (API, stream polls) that benefit from a brief
    // back-off. Image reads have their own bounded retry below, and the
    // renderer retries custom-protocol failures in place. Previously, a
    // single 3-second unhealthy window — rolled
    // forward by concurrent net::ERR_FAILED bursts from other Kick callers —
    // can leave the whole discover grid stuck on broken avatars/thumbnails.
    // The semaphore in `acquireKickRequestSlot` caps concurrency at 4, so
    // removing the gate doesn't re-introduce the thundering-herd it was
    // guarding against.
    //
    // Accepted tradeoffs (see PR review): (1) image net::ERR_* failures now
    // feed `recordPlatformLocalNetError`, so a CDN-only outage can arm the
    // gate for other Kick callers; (2) during a sustained outage, image
    // fetches occupy semaphore slots until each bounded attempt ends. The
    // initial timeout is intentionally short (3s); only transient errors get
    // the longer 8s recovery attempt, while permanent 4xx responses stop
    // immediately.
    const inFlight = _imageInFlight.get(url);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<KickImageBytes | null> => {
      try {
        const headers: Record<string, string> = {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        };

        const token = kickAuthService.getAccessToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        headers.Referer = "https://kick.com/";
        headers.Origin = "https://kick.com";
        headers["Sec-Fetch-Dest"] = "image";
        headers["Sec-Fetch-Mode"] = "no-cors";
        headers["Sec-Fetch-Site"] = "cross-site";

        // 3s timeout (vs the default 15s for API calls): image fetches are
        // best-effort and now contend for the same 4-slot semaphore as API
        // traffic during outages — see the bypass-justification block above.
        // Keep the first attempt short for a fast healthy grid, then retry the
        // same real provider URL once with a wider bounded budget. A one-off
        // timeout must not become a permanently missing thumbnail in the
        // renderer. Permanent 4xx responses still fail immediately and are
        // negative-cached below.
        const attemptTimeouts = [3000, 8000] as const;
        let lastError: unknown;
        for (const timeoutMs of attemptTimeouts) {
          try {
            const { buffer, contentType } = await this.electronRequestBinary(
              url,
              headers,
              timeoutMs
            );
            return { buffer, contentType };
          } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            if (/^HTTP 4\d{2}$/.test(message)) {
              throw error;
            }
          }
        }
        throw lastError;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isPermanent = /^HTTP 4\d{2}$/.test(message);
        if (isPermanent) {
          _imageNegativeCache.set(url, Date.now() + _IMAGE_NEG_CACHE_TTL_MS);
        } else if (isKickNetworkFailure(message)) {
          recordPlatformLocalNetError("kick");
        }
        const isQuiet = isPermanent || !isPlatformHealthy("kick");
        const log = isQuiet ? logger.debug : logger.warn;
        log("Kick:Client", "Image fetch failed", { message, url });
        return null;
      }
    })();

    _imageInFlight.set(url, promise);
    try {
      return await promise;
    } finally {
      _imageInFlight.delete(url);
    }
  }

  private async getOfficialApiBearerToken(): Promise<string | null> {
    if (kickAuthService.isAuthenticated()) {
      await kickAuthService.ensureValidToken();
      const userToken = kickAuthService.getAccessToken();
      if (userToken) {
        return userToken;
      }
    }

    return null;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    options.signal?.throwIfAborted();
    kickRateLimitGuard.assertRequestAllowed();
    let bearer = await this.getOfficialApiBearerToken();

    if (!bearer) {
      throw new Error("No Kick user token is available.");
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      // Add User-Agent and browser headers for Cloudflare/CDN compatibility
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://kick.com/",
      "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      ...(options.headers as Record<string, string>),
    };
    headers.Authorization = `Bearer ${bearer}`;

    const maxAttempts = 2;
    let attempt = 0;
    // Guard against double-refresh: ensureValidToken() above may have already
    // refreshed the token. We allow exactly one additional refresh on 401 in
    // case the token expired between the pre-flight check and the actual call.
    let retriedOn401 = false;

    while (attempt < maxAttempts) {
      options.signal?.throwIfAborted();
      attempt += 1;
      try {
        // Apply rate limiting to prevent 429 errors
        await kickRateLimiter.acquire();

        const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;
        const method = (options.method || "GET").toUpperCase();
        const body = options.body ? String(options.body) : undefined;

        // Use Electron's net module for proper IPv6-only domain handling
        const response = await this.electronRequest<T>(
          url,
          method,
          headers,
          body,
          options.signal ?? undefined
        );

        if (response.statusCode !== 200) {
          // Persist authoritative server backpressure before returning. This
          // prevents a rapid app restart from resetting the cooldown and
          // repeating the rejected request.
          if (response.statusCode === 429) {
            const retryHeader = response.responseHeaders["retry-after"];
            const rateLimitError = kickRateLimitGuard.recordRateLimit(retryHeader);
            logger.info("Kick:Client", "Kick API cooldown recorded", {
              retryAfterMs: rateLimitError.retryAfterMs,
            });
            throw rateLimitError;
          }

          // Handle transient server errors (500-504) with retry
          if (response.statusCode >= 500 && response.statusCode <= 504) {
            if (attempt >= maxAttempts) {
              throw new Error(`Kick API error: ${response.statusCode} (Max attempts exceeded)`);
            }

            const backoff = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
            logger.warn("Kick:Client", "Kick API server error; retrying", {
              statusCode: response.statusCode,
              backoffMs: backoff,
              attempt,
              maxAttempts,
            });
            await sleep(backoff);
            continue;
          }

          if (response.statusCode === 403) {
            logger.warn(
              "Kick:Client",
              "Kick API forbidden - may need additional scopes or User Token"
            );
          }

          if (response.statusCode === 401 && !retriedOn401) {
            // Token may have expired between the pre-flight ensureValidToken() and
            // the actual request. Attempt one refresh and update the Authorization
            // header in-place — no recursive call to avoid infinite loops.
            logger.debug(
              "Kick:Client",
              "Kick user token rejected (401); attempting one-shot refresh"
            );
            retriedOn401 = true;
            const refreshed = await kickAuthService.refreshToken();
            if (refreshed) {
              bearer = refreshed.accessToken;
              headers.Authorization = `Bearer ${refreshed.accessToken}`;
              continue; // retry the same request with the new token
            }
            // Refresh failed — kickAuthService already cleared state & emitted
            // 'session-expired'. Fall through to throw below.
          }

          throw new Error(`Kick API error: ${response.statusCode}`);
        }

        return response.data;
      } catch (error: unknown) {
        if (error instanceof KickRateLimitError) {
          throw error;
        }

        // Feed net::ERR_* into the health tracker so concurrent callers learn
        // about the outage and bail out of their own retry loops.
        const errMsg = error instanceof Error ? error.message : String(error);
        if (isKickNetworkFailure(errMsg)) {
          recordPlatformLocalNetError("kick");
        }

        if (isKickRequestCancellation(errMsg)) {
          logger.debug("Kick:Client", "Kick API request canceled", { endpoint });
        } else {
          logger.error("Kick:Client", "Kick API request failed", {
            endpoint,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
        throw error;
      }
    }

    throw new Error("Kick API request failed after retries");
  }

  /**
   * Check if the client is authenticated
   */
  isAuthenticated(): boolean {
    return kickAuthService.isAuthenticated();
  }

  // ========== User Endpoints ==========

  /**
   * Get the currently authenticated user
   */
  async getUser(): Promise<KickUser | null> {
    return UserEndpoints.getUser();
  }

  /**
   * Get users by IDs
   * https://docs.kick.com/apis/users - GET /public/v1/users?id[]=:id
   */
  async getUsersById(ids: number[]): Promise<KickApiUser[]> {
    return UserEndpoints.getUsersById(this, ids);
  }

  async getUsersByIdStrict(ids: number[]): Promise<KickApiUser[]> {
    return UserEndpoints.getUsersByIdStrict(this, ids);
  }

  /**
   * Get a channel-scoped public user profile using Kick's legacy/internal v2 web endpoint.
   */
  async getPublicChannelUserProfile(
    channelSlug: string,
    username: string
  ): Promise<UserEndpoints.KickPublicChannelUserProfile | null> {
    return UserEndpoints.getPublicChannelUserProfile(channelSlug, username);
  }

  async getPublicChannelUserProfiles(
    requests: Array<{ channelSlug: string; username: string }>
  ): Promise<
    Array<{
      channelSlug: string;
      profile: UserEndpoints.KickPublicChannelUserProfile | null;
    }>
  > {
    return UserEndpoints.getPublicChannelUserProfiles(requests);
  }

  // ========== Channel Endpoints ==========

  /**
   * Get channel info by slug
   * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug=:slug
   */
  async getChannel(
    slug: string,
    options?: { freshChatroomSettings?: boolean }
  ): Promise<UnifiedChannel | null> {
    return options
      ? ChannelEndpoints.getChannel(this, slug, options)
      : ChannelEndpoints.getChannel(this, slug);
  }

  async getOfficialChannelAccountStatus(slug: string) {
    return ChannelEndpoints.getOfficialKickChannelAccountStatus(this, slug);
  }

  /**
   * Get multiple channels by their slugs
   * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug=:slug&slug=:slug2
   */
  async getChannelsBySlugs(slugs: string[]): Promise<UnifiedChannel[]> {
    return ChannelEndpoints.getChannelsBySlugs(this, slugs);
  }

  /**
   * Get multiple channels by stable Kick broadcaster user IDs.
   * https://docs.kick.com/apis/channels - GET /public/v1/channels?broadcaster_user_id=:id
   */
  async getChannelsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedChannel[]> {
    return ChannelEndpoints.getChannelsByBroadcasterIds(this, broadcasterUserIds);
  }

  /**
   * Get channel info using the public/legacy API (No Auth Required)
   * GET https://kick.com/api/v1/channels/:slug
   */
  async getPublicChannel(slug: string): Promise<UnifiedChannel | null> {
    return ChannelEndpoints.getPublicChannel(slug);
  }

  /**
   * Search for channels (using categories search + livestreams)
   * Note: Official API doesn't have a direct channel search endpoint
   */
  async searchChannels(
    query: string,
    options: SearchEndpoints.ChannelSearchOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    return SearchEndpoints.searchChannels(this, query, options);
  }

  // ========== Stream Endpoints ==========

  /**
   * Get livestream by channel slug
   */
  async getStreamBySlug(
    slug: string,
    options: { freshStatus?: boolean } = {}
  ): Promise<UnifiedStream | null> {
    return StreamEndpoints.getStreamBySlug(this, slug, options);
  }

  async getStreamsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedStream[]> {
    return StreamEndpoints.getStreamsByBroadcasterIds(this, broadcasterUserIds);
  }

  /**
   * Get stream info using the public/legacy API (No Auth Required)
   */
  async getPublicStreamBySlug(
    slug: string,
    staggerOffsetMs?: number,
    signal?: AbortSignal
  ): Promise<UnifiedStream | null> {
    return StreamEndpoints.getPublicStreamBySlug(slug, staggerOffsetMs, signal);
  }

  /**
   * Get top/featured live streams
   * https://docs.kick.com/apis/livestreams - GET /public/v1/livestreams
   */
  async getTopStreams(options: TopStreamsOptions = {}): Promise<PageResult<UnifiedStream>> {
    const result = await StreamEndpoints.getTopStreams(this, options);
    return { data: result.data, cursor: result.cursor };
  }

  /**
   * Get top streams using the legacy public API
   */
  async getPublicTopStreams(
    options: PaginationOptions & { categoryId?: string; language?: string } = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getPublicTopStreams(options);
  }

  /**
   * Get streams by category
   * https://docs.kick.com/apis/livestreams - GET /public/v1/livestreams?category_id=:id
   *
   * Pass `categoryName` to enable the slug-guess fallback for cross-platform
   * lookups where the Kick numeric id may not resolve to live streams.
   */
  async getStreamsByCategory(
    categoryId: string,
    options: PaginationOptions & { categoryName?: string; language?: string } = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getStreamsByCategory(this, categoryId, options);
  }

  /**
   * Get followed streams (live channels the user follows)
   * Note: Official API doesn't have a direct followed streams endpoint
   */
  async getFollowedStreams(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getFollowedStreams(this, options);
  }

  // ========== Category Endpoints ==========

  /**
   * Get top/popular categories (derived from top streams)
   * Note: Kick official API doesn't have a "browse all" endpoint, so we aggregate from streams
   */
  async getTopCategories(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    return CategoryEndpoints.getTopCategories(this, options);
  }

  /**
   * Search for categories
   * https://docs.kick.com/apis/categories - GET /public/v1/categories?q=:query
   */
  async searchCategories(
    query: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    return CategoryEndpoints.searchCategories(this, query, options);
  }

  /**
   * Get category by ID
   * https://docs.kick.com/apis/categories - GET /public/v1/categories/:category_id
   */
  async getCategoryById(id: string): Promise<UnifiedCategory | null> {
    return CategoryEndpoints.getCategoryById(this, id);
  }

  /**
   * Get ALL categories using multiple strategies
   * Fetches from streams + search to maximize category discovery
   */
  async getAllCategories(): Promise<UnifiedCategory[]> {
    return CategoryEndpoints.getAllCategories(this);
  }

  // ========== Follows Endpoints ==========
  // Sourced from the undocumented internal v2 endpoint
  // (kick.com/api/v2/channels/followed) since the official Kick Public API has
  // no followed-channels endpoint. The endpoint is fetched with the OAuth
  // Bearer token via FollowEndpoints (see follow-endpoints.ts for the failure
  // classification model and the rationale for not gating behind
  // isPlatformHealthy). This convenience returns a flat array; callers that
  // need the failure tag (notably syncFollowsOnLogin) should import
  // FollowEndpoints directly so a transient fetch failure doesn't get
  // silently coerced into "user follows zero channels" — see U4/A1 in
  // docs/plans/2026-05-21-001-feat-kick-account-follows-import-plan.md.

  /**
   * Get followed channels (paginated convenience).
   * The v2 endpoint returns the full list in one response; the PaginationOptions
   * arg is preserved only for interface symmetry with other endpoint methods.
   */
  async getFollowedChannels(
    _options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    const result = await FollowEndpoints.getAllFollowedChannels();
    return { data: result.status === "ok" ? result.channels : [] };
  }

  /**
   * Get all followed channels (flat array).
   * Returns [] on any error. Callers that need to distinguish "follows zero
   * channels" from "fetch failed" must use FollowEndpoints.getAllFollowedChannels()
   * directly for the tagged result.
   */
  async getAllFollowedChannels(): Promise<UnifiedChannel[]> {
    const result = await FollowEndpoints.getAllFollowedChannels();
    return result.status === "ok" ? result.channels : [];
  }

  // ========== Search ==========

  /**
   * Full search across channels, categories, channels, streams, videos, and clips
   */
  async search(
    query: string,
    options: { channelSeeds?: UnifiedChannel[]; signal?: AbortSignal } = {}
  ): Promise<Awaited<ReturnType<typeof SearchEndpoints.search>>> {
    return SearchEndpoints.search(this, query, options);
  }

  // ========== Videos ==========

  /**
   * Get videos by channel slug
   */
  async getVideos(
    slug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof VideoEndpoints.getVideosByChannelSlug>>> {
    return VideoEndpoints.getVideosByChannelSlug(slug, options);
  }

  // ========== Clips ==========
  // Note: Clips endpoint not documented in official API

  /**
   * Get clips for a channel
   */
  async getClips(
    slug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof ClipEndpoints.getClipsByChannelSlug>>> {
    return ClipEndpoints.getClipsByChannelSlug(slug, options);
  }

  /** Get clips from Kick's native Category feed. */
  async getClipsByCategory(
    categorySlug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof ClipEndpoints.getClipsByCategorySlug>>> {
    return ClipEndpoints.getClipsByCategorySlug(categorySlug, options);
  }
}

export const kickClient = new KickClient();

clients.register(kickClient);
