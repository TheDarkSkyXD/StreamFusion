import {
  isKickNetworkFailure,
  isKickRequestCancellation,
} from "@backend/api/platforms/kick/kick-error-classification";
import { acquireKickRequestSlot } from "@backend/api/platforms/kick/kick-network-health";
import {
  KickRateLimitError,
  kickRateLimitGuard,
} from "@backend/api/platforms/kick/kick-rate-limit-guard";
import type { KickRequestor } from "@backend/api/platforms/kick/kick-requestor";
import { KICK_API_BASE } from "@backend/api/platforms/kick/kick-types";
import {
  isPlatformHealthy,
  recordPlatformLocalNetError,
} from "@backend/api/unified/platform-health";
import { kickAuthService } from "@backend/features/authentication/adapters/kick/kick-auth";
import { logger } from "@backend/logging/logger";
import {
  readResponseTextWithinLimit,
  ResponseBodyTooLargeError,
} from "@backend/reliability/bounded-response-body";
import {
  purgeStoredThirdPartyCookies,
  registerThirdPartyCookieStripper,
} from "@backend/services/third-party-cookie-stripper";
import { sleep } from "@shared/utils/sleep";
import { session } from "electron";

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

const kickRateLimiter = new KickRateLimiter();

export interface KickImageBytes {
  buffer: Buffer;
  contentType: string;
}

const _imageInFlight = new Map<string, Promise<KickImageBytes | null>>();

const _imageNegativeCache = new Map<string, number>();

const _IMAGE_NEG_CACHE_TTL_MS = 10 * 60 * 1000;

export class KickTransport implements KickRequestor {
  readonly baseUrl = KICK_API_BASE;

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

  private cdnSession: Electron.Session | null = null;

  private cdnSessionInitialization: Promise<Electron.Session> | null = null;

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

  isAuthenticated(): boolean {
    return kickAuthService.isAuthenticated();
  }
}
export const kickTransport = new KickTransport();
