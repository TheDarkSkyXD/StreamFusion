/**
 * Kick API Client
 *
 * Client for interacting with the official Kick Public API v1.
 * API Documentation: https://docs.kick.com/
 *
 * Handles authentication and data fetching for stream discovery.
 */

import type { KickUser } from "../../../../shared/auth-types";
import { kickAuthService } from "../../../auth/kick-auth";
import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "../../unified/platform-types";

// Re-export common types for compatibility
export type { PaginatedResult, PaginationOptions } from "./kick-types";

// Import endpoints
import * as CategoryEndpoints from "./endpoints/category-endpoints";
import * as ChannelEndpoints from "./endpoints/channel-endpoints";
import * as ClipEndpoints from "./endpoints/clip-endpoints";
import * as SearchEndpoints from "./endpoints/search-endpoints";
import * as StreamEndpoints from "./endpoints/stream-endpoints";
import * as UserEndpoints from "./endpoints/user-endpoints";
import * as VideoEndpoints from "./endpoints/video-endpoints";
import type { KickRequestor } from "./kick-requestor";
import type { KickApiUser, PaginatedResult, PaginationOptions } from "./kick-types";

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
        await new Promise((r) => setTimeout(r, waitTime));
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

// ========== Kick API Client Class ==========

class KickClient implements KickRequestor {
  readonly baseUrl = "https://streamfusion.leveluptogetherbiz.workers.dev/kick";

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
  private electronRequest<T>(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{ data: T; statusCode: number; responseHeaders: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const { net } = require("electron");

      const request = net.request({
        method,
        url,
      });

      // Set headers
      for (const [key, value] of Object.entries(headers)) {
        request.setHeader(key, value);
      }

      // Track completion
      let completed = false;

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        request.abort();
        reject(new Error("Request timeout after 30s"));
      }, 30000);

      request.on("response", (response: any) => {
        let responseBody = "";
        const responseHeaders: Record<string, string> = {};

        // Collect response headers
        if (response.headers) {
          for (const [key, value] of Object.entries(response.headers)) {
            responseHeaders[key.toLowerCase()] = Array.isArray(value)
              ? value[0]
              : (value as string);
          }
        }

        response.on("data", (chunk: Buffer) => {
          responseBody += chunk.toString();
        });

        response.on("end", () => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          try {
            const data = responseBody ? JSON.parse(responseBody) : null;
            resolve({
              data: data as T,
              statusCode: response.statusCode,
              responseHeaders,
            });
          } catch (_e) {
            reject(new Error(`Failed to parse JSON response: ${responseBody.substring(0, 200)}`));
          }
        });

        response.on("error", (error: Error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          reject(error);
        });
      });

      request.on("error", (error: Error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        reject(error);
      });

      // Send body if present
      if (body) {
        const contentLength = Buffer.byteLength(body, "utf8");
        request.setHeader("Content-Length", contentLength.toString());
        request.write(body);
      }

      request.end();
    });
  }

  // Lazy-initialized direct session for CDN requests (bypasses proxy)
  private cdnSession: Electron.Session | null = null;

  /**
   * Get or create a session configured for direct CDN access (no proxy)
   * This prevents 403 errors from proxy interference
   */
  private async getCdnSession(): Promise<Electron.Session> {
    if (this.cdnSession) {
      return this.cdnSession;
    }

    const { session } = require("electron");

    // Create dedicated session for CDN requests with no proxy
    const cdnSession: Electron.Session = session.fromPartition("persist:kick-cdn-direct");

    // Configure to bypass all proxies for CDN domains
    await cdnSession.setProxy({
      mode: "direct", // Bypass all proxy settings
    });

    // Close any existing connections to ensure new settings take effect
    await cdnSession.closeAllConnections();

    // Cache the session
    this.cdnSession = cdnSession;

    return cdnSession;
  }

  /**
   * Make a binary HTTP request using Electron's net module (for images)
   * Uses a dedicated session with direct connection to bypass proxy and avoid 403 errors
   */
  private async electronRequestBinary(
    url: string,
    headers: Record<string, string>
  ): Promise<{ buffer: Buffer; statusCode: number; contentType: string }> {
    // Get direct session to bypass proxy
    const directSession = await this.getCdnSession();

    return new Promise((resolve, reject) => {
      const { net } = require("electron");

      const request = net.request({
        method: "GET",
        url,
        session: directSession, // Use direct session (no proxy)
        useSessionCookies: false, // Don't send cookies to avoid 403 errors
      });

      for (const [key, value] of Object.entries(headers)) {
        request.setHeader(key, value);
      }

      let completed = false;

      // Timeout
      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        request.abort();
        reject(new Error("Request timeout"));
      }, 15000);

      request.on("response", (response: any) => {
        if (response.statusCode !== 200) {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        const contentType = response.headers["content-type"]?.[0] || "image/jpeg";

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            statusCode: response.statusCode,
            contentType,
          });
        });

        response.on("error", (error: Error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          reject(error);
        });
      });

      request.on("error", (error: Error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        reject(error);
      });

      request.end();
    });
  }

  /**
   * Fetch an image provided a URL and return it as a base64 data URL
   * Uses the same network stack and headers as other Kick requests
   */
  async fetchImage(url: string): Promise<string | null> {
    try {
      // 1. Setup headers exactly like browser requests for CDN compatibility
      const headers: Record<string, string> = {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        // CRITICAL: User-Agent is REQUIRED for Cloudflare/CDN to not return 403
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };

      // Add Auth token if we have one (user auth only — App Token flow is not available)
      const token = kickAuthService.getAccessToken();

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      // Important: Referer/Origin for Hotlinking protection
      headers.Referer = "https://kick.com/";
      headers.Origin = "https://kick.com";
      headers["Sec-Fetch-Dest"] = "image";
      headers["Sec-Fetch-Mode"] = "no-cors";
      headers["Sec-Fetch-Site"] = "cross-site";

      const { buffer, contentType } = await this.electronRequestBinary(url, headers);

      const base64 = buffer.toString("base64");
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.warn(`[KickClient] Failed to fetch image ${url}:`, error);
      return null;
    }
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let token: string | null = null;
    const isAppToken = false;

    // Try User Token — App Token flow is intentionally skipped because
    // client credentials live on the Cloudflare Worker and no
    // /auth/kick/app-token proxy endpoint has been created yet.
    // Callers should fall back to the public (no-auth) API when the user
    // hasn't logged into Kick.
    if (kickAuthService.isAuthenticated()) {
      await kickAuthService.ensureValidToken();
      token = kickAuthService.getAccessToken();
    }

    if (!token) {
      throw new Error("Not authenticated with Kick. Use the public API fallback.");
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

    const maxRetries = 3;
    let attempt = 0;
    // Guard against double-refresh: ensureValidToken() above may have already
    // refreshed the token. We allow exactly one additional refresh on 401 in
    // case the token expired between the pre-flight check and the actual call.
    let retriedOn401 = false;

    while (attempt <= maxRetries) {
      try {
        // Apply rate limiting to prevent 429 errors
        await kickRateLimiter.acquire();

        const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;
        const method = (options.method || "GET").toUpperCase();
        const body = options.body ? String(options.body) : undefined;

        // Use Electron's net module for proper IPv6-only domain handling
        const response = await this.electronRequest<T>(url, method, headers, body);

        if (response.statusCode !== 200) {
          // Handle rate limiting (429) with retry
          if (response.statusCode === 429) {
            attempt++;
            if (attempt > maxRetries) {
              throw new Error(`Kick API error: 429 (Max retries exceeded)`);
            }

            // Calculate backoff: 5s, 10s, 20s (longer delays for rate limiting)
            // Use Retry-After header if available
            const retryHeader = response.responseHeaders["retry-after"];
            const backoff = retryHeader
              ? parseInt(retryHeader, 10) * 1000
              : 5000 * 2 ** (attempt - 1); // 5s, 10s, 20s

            console.warn(
              `⚠️ Kick API 429 Too Many Requests. Retrying in ${backoff}ms (Attempt ${attempt}/${maxRetries})...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }

          // Handle transient server errors (502, 503, 504) with retry
          if (
            response.statusCode === 502 ||
            response.statusCode === 503 ||
            response.statusCode === 504
          ) {
            attempt++;
            if (attempt > maxRetries) {
              throw new Error(`Kick API error: ${response.statusCode} (Max retries exceeded)`);
            }

            const backoff = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
            console.warn(
              `⚠️ Kick API ${response.statusCode} Server Error. Retrying in ${backoff}ms (Attempt ${attempt}/${maxRetries})...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }

          if (response.statusCode === 403) {
            console.warn("⚠️ Kick API forbidden - may need additional scopes or User Token");
          }

          if (response.statusCode === 401 && !isAppToken && !retriedOn401) {
            // Token may have expired between the pre-flight ensureValidToken() and
            // the actual request. Attempt one refresh and update the Authorization
            // header in-place — no recursive call to avoid infinite loops.
            console.debug("🔄 Kick user token rejected (401), attempting one-shot refresh...");
            retriedOn401 = true;
            const refreshed = await kickAuthService.refreshToken();
            if (refreshed) {
              headers.Authorization = `Bearer ${refreshed.accessToken}`;
              continue; // retry the same request with the new token
            }
            // Refresh failed — kickAuthService already cleared state & emitted
            // 'session-expired'. Fall through to throw below.
          }

          throw new Error(`Kick API error: ${response.statusCode}`);
        }

        return response.data;
      } catch (error: any) {
        // If it's a 429 error we deliberately threw above, re-throw it
        if (error.message?.includes("429")) {
          throw error;
        }

        // Network errors - log and throw
        console.error(`❌ Kick API request failed: ${endpoint}`, error);
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

  // ========== Channel Endpoints ==========

  /**
   * Get channel info by slug
   * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug[]=:slug
   */
  async getChannel(slug: string): Promise<UnifiedChannel | null> {
    return ChannelEndpoints.getChannel(this, slug);
  }

  /**
   * Get multiple channels by their slugs
   * https://docs.kick.com/apis/channels - GET /public/v1/channels?slug[]=:slug&slug[]=:slug2
   */
  async getChannelsBySlugs(slugs: string[]): Promise<UnifiedChannel[]> {
    return ChannelEndpoints.getChannelsBySlugs(this, slugs);
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
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    return SearchEndpoints.searchChannels(this, query, options);
  }

  // ========== Stream Endpoints ==========

  /**
   * Get livestream by channel slug
   */
  async getStreamBySlug(slug: string): Promise<UnifiedStream | null> {
    return StreamEndpoints.getStreamBySlug(this, slug);
  }

  /**
   * Get stream info using the public/legacy API (No Auth Required)
   */
  async getPublicStreamBySlug(slug: string): Promise<UnifiedStream | null> {
    return StreamEndpoints.getPublicStreamBySlug(slug);
  }

  /**
   * Get top/featured live streams
   * https://docs.kick.com/apis/livestreams - GET /public/v1/livestreams
   */
  async getTopStreams(
    options: PaginationOptions & { categoryId?: string; language?: string } = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getTopStreams(this, options);
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
   */
  async getStreamsByCategory(
    categoryId: string,
    options: PaginationOptions = {}
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
  // Note: The official Kick API does not currently have endpoints for follows

  /**
   * Get followed channels
   * Note: Not available in official API
   */
  async getFollowedChannels(
    _options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    console.warn("⚠️ Kick official API does not support followed channels endpoint");
    return { data: [] };
  }

  /**
   * Get all followed channels
   * Note: Not available in official API
   */
  async getAllFollowedChannels(): Promise<UnifiedChannel[]> {
    return [];
  }

  // ========== Search ==========

  /**
   * Full search across channels, categories, channels, streams, videos, and clips
   */
  async search(
    query: string
  ): Promise<{ channels: any[]; categories: any[]; streams: any[]; videos: any[]; clips: any[] }> {
    return SearchEndpoints.search(this, query);
  }

  // ========== Videos ==========

  /**
   * Get videos by channel slug
   */
  async getVideos(slug: string, options: PaginationOptions = {}): Promise<PaginatedResult<any>> {
    return VideoEndpoints.getVideosByChannelSlug(slug, options);
  }

  // ========== Clips ==========
  // Note: Clips endpoint not documented in official API

  /**
   * Get clips for a channel
   */
  async getClips(slug: string, options: PaginationOptions = {}): Promise<PaginatedResult<any>> {
    return ClipEndpoints.getClipsByChannelSlug(slug, options);
  }
}

export const kickClient = new KickClient();
