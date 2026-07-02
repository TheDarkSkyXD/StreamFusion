/**
 * Twitch Manifest Proxy Service
 *
 * Intercepts HLS manifest requests at the Electron session level
 * and processes them through VAFT-style ad removal before they
 * reach the renderer. This provides network-transparent ad blocking.
 *
 * @see https://github.com/pixeltris/TwitchAdSolutions
 */

import { DEFAULT_DATERANGE_PATTERNS } from "@shared/adblock-types";
import { session } from "electron";

import { logger } from "@/backend/logging/logger";
import { sleep } from "@/lib/sleep";
import { httpClient } from "./http-client";
import { vaftPatternService } from "./vaft-pattern-service";

/**
 * Resolution info for a stream quality level
 */
interface ResolutionInfo {
  resolution: string;
  bandwidth: number;
  codecs: string;
  frameRate: number;
}

/**
 * Stream state tracking for the proxy
 */
interface ProxyStreamInfo {
  channelName: string;
  encodingsM3u8: string | null;
  last160pSegment: string | null;
  baseline160pUrl: string | null;
  isInAdBreak: boolean;
  usherParams: string;
  resolutions: Map<string, ResolutionInfo>;
  lastKnownBitrate: number | null;
}

/**
 * Proxy statistics
 */
interface ProxyStats {
  manifestsProcessed: number;
  adsDetected: number;
  backupsFetched: number;
  segmentsReplaced: number;
}

/**
 * Player types to try for ad-free backup streams
 */
const BACKUP_PLAYER_TYPES = [
  "embed",
  "popout",
  "autoplay",
  "picture-by-picture",
  "thunderdome",
] as const;
type PlayerType = (typeof BACKUP_PLAYER_TYPES)[number];

/**
 * Twitch GQL Client ID
 */
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

/**
 * GQL Persisted Query Hash for PlaybackAccessToken
 */
const ACCESS_TOKEN_HASH = "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";

class TwitchManifestProxyService {
  private streamInfos = new Map<string, ProxyStreamInfo>();
  private isEnabled = true;
  private isRegistered = false;
  private stats: ProxyStats = {
    manifestsProcessed: 0,
    adsDetected: 0,
    backupsFetched: 0,
    segmentsReplaced: 0,
  };

  /**
   * Default timeout for fetch operations (ms)
   * Aggressive timeout to prevent stream freezing
   */
  private static readonly FETCH_TIMEOUT = 2000;

  /**
   * Fetch with automatic retry for transient network errors.
   * Uses aggressive timeouts and minimal retries to prevent stream freezing.
   *
   * IMPORTANT: Reduced from 3 retries to 1, and delay from 500ms to 200ms
   * to prioritize stream continuity over backup stream quality.
   */
  private async fetchWithRetry(
    url: string,
    options?: Parameters<typeof fetch>[1],
    maxRetries: number = 1,
    baseDelay: number = 200
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add timeout via AbortSignal
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(TwitchManifestProxyService.FETCH_TIMEOUT),
        });
        return response;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        const delay = baseDelay * 2 ** attempt;
        logger.debug("Service:TwitchManifest", "Fetch failed, retrying", {
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Check if an error is retryable (transient network issues)
   * Note: AbortError from timeout is NOT retryable - we want to fail fast
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // AbortError means our timeout triggered - don't retry, fail fast
      if (error.name === "AbortError") {
        return false;
      }

      // Check cause first (Node.js fetch wraps real error in cause)
      const cause = (error as Error & { cause?: { code?: string } }).cause;
      const code = cause?.code || (error as Error & { code?: string }).code;

      // Network-level errors that are typically transient
      const retryableCodes = [
        "ECONNRESET", // Connection reset (TLS handshake failure)
        "ETIMEDOUT", // Connection timed out
        "ENOTFOUND", // DNS lookup failed (transient)
        "ECONNREFUSED", // Connection refused
        "ENETUNREACH", // Network unreachable
        "EHOSTUNREACH", // Host unreachable
        "EPIPE", // Broken pipe
        "EAI_AGAIN", // DNS temporary failure
      ];

      if (code && retryableCodes.includes(code)) {
        return true;
      }

      // Check error message for fetch failures
      const message = error.message.toLowerCase();
      if (
        message.includes("fetch failed") ||
        message.includes("network") ||
        message.includes("socket") ||
        message.includes("ssl") ||
        message.includes("handshake") ||
        message.includes("disconnected")
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear stream info and cleanup resources for a channel
   * Called when stream processing completes or on error
   */
  clearStreamInfo(channelName: string): void {
    this.streamInfos.delete(channelName.toLowerCase());
  }

  /**
   * Clear all stream infos (called on cleanup)
   */
  clearAllStreamInfos(): void {
    this.streamInfos.clear();
  }

  /**
   * Register the manifest interceptor with Electron's session
   */
  registerInterceptor(): void {
    if (this.isRegistered) {
      logger.debug("Service:TwitchManifest", "Already registered");
      return;
    }

    session.defaultSession.webRequest.onBeforeRequest(
      {
        urls: [
          // Match all ttvnw.net subdomains with m3u8 files
          // Electron doesn't support wildcards in the middle of hostnames
          // so we use broader patterns and filter in the handler
          "*://*.ttvnw.net/*.m3u8*",
        ],
      },
      (details, callback) => {
        if (!this.isEnabled) {
          callback({});
          return;
        }

        // Filter to only process relevant Twitch HLS manifest URLs
        const url = details.url;
        const isRelevantUrl =
          url.includes("usher.ttvnw.net") ||
          url.includes("video-weaver") ||
          url.includes(".hls.ttvnw.net");

        if (!isRelevantUrl) {
          callback({});
          return;
        }

        // Use Promise chain instead of async/await to satisfy Electron's callback contract
        // fetchWithRetry handles transient SSL/network errors with exponential backoff
        this.fetchWithRetry(details.url)
          .then((response) => {
            if (!response.ok) {
              callback({});
              return null;
            }
            return response.text();
          })
          .then((originalText) => {
            if (originalText === null) {
              return; // Already called callback above
            }
            return this.processManifest(details.url, originalText).then((processedText) => {
              // Return as Base64 data URL
              const base64 = Buffer.from(processedText).toString("base64");
              callback({
                redirectURL: `data:application/vnd.apple.mpegurl;base64,${base64}`,
              });
              this.stats.manifestsProcessed++;
            });
          })
          .catch((error) => {
            logger.error("Service:TwitchManifest", "Manifest fetch error", {
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : String(error),
            });
            callback({});
          });
      }
    );

    this.isRegistered = true;
    logger.debug("Service:TwitchManifest", "Registered manifest interceptor");
  }

  /**
   * Process a manifest (master or media playlist)
   */
  private async processManifest(url: string, text: string): Promise<string> {
    if (this.isMasterPlaylist(url)) {
      return this.processMasterPlaylist(url, text);
    } else {
      return this.processMediaPlaylist(url, text);
    }
  }

  /**
   * Check if URL is a master playlist (usher.ttvnw.net)
   */
  private isMasterPlaylist(url: string): boolean {
    return url.includes("usher.ttvnw.net");
  }

  /**
   * Process master playlist - extract resolution info and identify 160p stream
   */
  private processMasterPlaylist(url: string, text: string): string {
    const channelName = this.extractChannelName(url);
    if (!channelName) return text;

    const urlObj = new URL(url);
    const streamInfo: ProxyStreamInfo = {
      channelName,
      encodingsM3u8: text,
      last160pSegment: null,
      baseline160pUrl: null,
      isInAdBreak: false,
      usherParams: urlObj.search,
      resolutions: new Map(),
      lastKnownBitrate: null,
    };

    // Parse resolutions and find 160p stream
    const lines = text.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const attrs = this.parseAttributes(lines[i]);
        const resolution = attrs.RESOLUTION;
        const bandwidth = parseInt(attrs.BANDWIDTH, 10);

        if (resolution) {
          const streamUrl = lines[i + 1].trim();
          streamInfo.resolutions.set(streamUrl, {
            resolution,
            bandwidth,
            codecs: attrs.CODECS || "",
            frameRate: parseFloat(attrs["FRAME-RATE"]) || 30,
          });

          // Identify 160p stream (BANDWIDTH ~160000-400000)
          if (bandwidth >= 160000 && bandwidth <= 400000) {
            streamInfo.baseline160pUrl = streamUrl;
          }
        }
      }
    }

    this.streamInfos.set(channelName, streamInfo);
    logger.debug("Service:TwitchManifest", "Registered stream", {
      channelName,
      qualities: streamInfo.resolutions.size,
    });

    return text;
  }

  /**
   * Process media playlist - detect ads and apply replacement
   */
  private async processMediaPlaylist(url: string, text: string): Promise<string> {
    const streamInfo = this.findStreamInfoByUrl(url);
    if (!streamInfo) return text;

    // Neutralize tracking URLs first
    text = this.neutralizeTrackingUrls(text);

    // Detect ads using multiple heuristics
    const hasAd = this.detectAds(text);

    if (hasAd) {
      this.stats.adsDetected++;

      if (!streamInfo.isInAdBreak) {
        streamInfo.isInAdBreak = true;
        logger.debug("Service:TwitchManifest", "Ad detected", {
          channelName: streamInfo.channelName,
        });
      }

      // Try backup stream first
      const backupText = await this.tryGetBackupStream(streamInfo, url);
      if (backupText && !this.detectAds(backupText)) {
        this.stats.backupsFetched++;
        return backupText;
      }

      // Fallback: Strip ad segments and replace with 160p
      return this.replaceAdSegments(text, streamInfo);
    } else if (streamInfo.isInAdBreak) {
      streamInfo.isInAdBreak = false;
      logger.debug("Service:TwitchManifest", "Ad ended", {
        channelName: streamInfo.channelName,
      });
    }

    // Store last valid 160p segment for replacement
    this.updateBaseline160pSegment(text, streamInfo);

    return text;
  }

  /**
   * Detect ads using multiple heuristics
   * Uses dynamic patterns from VAFT pattern service when available
   */
  private detectAds(text: string): boolean {
    // Get patterns from VAFT pattern service (auto-updated)
    let dateRangePatterns: readonly string[];
    let adSignifiers: string[];

    try {
      dateRangePatterns = vaftPatternService.getDateRangePatterns();
      adSignifiers = vaftPatternService.getAdSignifiers();
    } catch {
      // Fallback to defaults if service not initialized
      dateRangePatterns = DEFAULT_DATERANGE_PATTERNS;
      adSignifiers = ["stitched"];
    }

    // Primary: DATERANGE tags with ad indicators
    if (text.includes("#EXT-X-DATERANGE")) {
      for (const pattern of dateRangePatterns) {
        if (text.includes(pattern)) {
          return true;
        }
      }
    }

    // Secondary: ad signifiers (e.g., 'stitched')
    for (const signifier of adSignifiers) {
      if (text.includes(signifier)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Neutralize ad tracking URLs
   */
  private neutralizeTrackingUrls(text: string): string {
    const safeUrl = "https://twitch.tv";
    return text
      .replace(/(X-TV-TWITCH-AD-URL=")[^"]*(")/g, `$1${safeUrl}$2`)
      .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/g, `$1${safeUrl}$2`)
      .replace(/(X-TV-TWITCH-AD-ROLL-TYPE=")[^"]*(")/g, `$1$2`);
  }

  /**
   * Replace ad segments with 160p content
   */
  private replaceAdSegments(text: string, streamInfo: ProxyStreamInfo): string {
    if (!streamInfo.last160pSegment) {
      // No 160p cached - just strip ad segments
      return this.stripAdSegmentsMinimal(text);
    }

    const lines = text.split("\n");
    const result: string[] = [];
    let segmentsReplaced = 0;

    let hasProgramDateTime = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track program date time for live segment detection
      if (line.startsWith("#EXT-X-DISCONTINUITY")) {
        hasProgramDateTime = false;
      }
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME")) {
        hasProgramDateTime = true;
      }

      // Detect ad segment
      if (line.startsWith("#EXTINF") && i + 1 < lines.length) {
        const segmentUrl = lines[i + 1];

        // A segment is an ad if:
        // 1. It's explicitly a known ad URL
        // 2. OR it's NOT marked as live AND NOT part of a program date time block
        const isLiveInfo = line.includes(",live") || hasProgramDateTime;
        const isAdSegment = this.isKnownAdSegment(segmentUrl) || !isLiveInfo;

        if (isAdSegment) {
          // Keep EXTINF but replace segment URL with 160p
          result.push(line);
          result.push(streamInfo.last160pSegment);
          segmentsReplaced++;
          i++; // Skip original segment URL
          continue;
        }
      }

      // Remove prefetch during ads
      if (streamInfo.isInAdBreak && line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
        continue;
      }

      result.push(line);
    }

    this.stats.segmentsReplaced += segmentsReplaced;
    return result.join("\n");
  }

  /**
   * Strip ad segments minimally (when no 160p available)
   */
  private stripAdSegmentsMinimal(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip DATERANGE ad markers
      if (
        line.startsWith("#EXT-X-DATERANGE") &&
        (line.includes("stitched-ad") || line.includes("amazon-ad"))
      ) {
        continue;
      }

      // Skip prefetch during ads
      if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
        continue;
      }

      result.push(line);
    }

    return result.join("\n");
  }

  /**
   * Update baseline 160p segment from clean playlist
   */
  private updateBaseline160pSegment(text: string, streamInfo: ProxyStreamInfo): void {
    // Only update from clean (non-ad) playlists
    if (this.detectAds(text)) return;

    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith("#EXTINF") && lines[i].includes(",live")) {
        const segmentUrl = lines[i + 1]?.trim();
        if (segmentUrl?.startsWith("https://")) {
          streamInfo.last160pSegment = segmentUrl;
          break;
        }
      }
    }
  }

  /**
   * Try a single player type for backup stream (for parallel fetching)
   */
  private async tryPlayerTypeBackup(
    streamInfo: ProxyStreamInfo,
    originalUrl: string,
    playerType: PlayerType
  ): Promise<{ playerType: PlayerType; m3u8: string } | null> {
    try {
      const token = await this.getAccessToken(streamInfo.channelName, playerType);
      if (!token) return null;

      const usherUrl = this.buildUsherUrl(streamInfo, token);
      const encodingsResponse = await this.fetchWithRetry(usherUrl);
      if (!encodingsResponse.ok) return null;

      const encodingsM3u8 = await encodingsResponse.text();
      const streamUrl = this.getMatchingStreamUrl(encodingsM3u8, originalUrl, streamInfo);
      if (!streamUrl) return null;

      const mediaResponse = await this.fetchWithRetry(streamUrl);
      if (!mediaResponse.ok) return null;

      const mediaText = await mediaResponse.text();
      return { playerType, m3u8: mediaText };
    } catch {
      // Fail silently - other player types may succeed
      return null;
    }
  }

  /**
   * Try to get backup stream without ads.
   *
   * Fires all player types concurrently but consumes their results in priority
   * order (embed/popout serve Source quality; autoplay/picture-by-picture are
   * capped at 360p by Twitch). Returns the highest-priority CLEAN backup as soon
   * as it resolves, instead of waiting for the slowest player type to settle — a
   * slow/timing-out type no longer delays a fast clean Source stream and starves
   * the player into an ABR downshift.
   */
  private async tryGetBackupStream(
    streamInfo: ProxyStreamInfo,
    originalUrl: string
  ): Promise<string | null> {
    // Start every player type in parallel...
    const backupPromises = BACKUP_PLAYER_TYPES.map((playerType) =>
      this.tryPlayerTypeBackup(streamInfo, originalUrl, playerType)
    );

    // ...but consume them in priority order and return on the first clean hit.
    let firstAvailable: { playerType: PlayerType; m3u8: string } | null = null;
    for (const promise of backupPromises) {
      const result = await promise;
      if (!result) continue;
      if (!firstAvailable) {
        firstAvailable = result;
      }
      if (!this.detectAds(result.m3u8)) {
        logger.debug("Service:TwitchManifest", "Using backup", { playerType: result.playerType });
        return result.m3u8;
      }
    }

    // No clean backup - return the highest-priority result for segment stripping.
    return firstAvailable?.m3u8 ?? null;
  }

  /**
   * Get access token with parent_domains stripped
   *
   * IMPORTANT DOCUMENTATION:
   * -------------------------
   * This method strips `parent_domains` and `parent_referrer_domains` from Twitch
   * playback tokens to bypass embed detection. This is necessary because:
   *
   * 1. Business Need: Twitch uses parent_domains to detect if the player is embedded
   *    on a third-party site and serves additional ads to embedded players. Stripping
   *    these fields makes the request appear to come from twitch.tv directly.
   *
   * 2. Legal/TOS Implications: This may violate Twitch's Terms of Service. Use at
   *    your own risk. This is intended for personal ad-blocking purposes only.
   *
   * 3. Known Risks:
   *    - Twitch may detect this bypass and block/ban accounts
   *    - Twitch may change their API to require these fields
   *    - This may stop working at any time without notice
   *
   * TODO: Explore official alternatives:
   * - Twitch OAuth2/Helix APIs for authorized playback
   * - Official Twitch embed flows with ad support
   * - See: https://dev.twitch.tv/docs/embed/
   *
   * ACCEPTANCE OF RISK: By using this functionality, you acknowledge the risks
   * and accept responsibility for any consequences.
   */
  private async getAccessToken(
    channelName: string,
    playerType: PlayerType
  ): Promise<{ signature: string; value: string } | null> {
    const body = {
      operationName: "PlaybackAccessToken",
      variables: {
        isLive: true,
        login: channelName,
        isVod: false,
        vodID: "",
        playerType,
        platform: playerType === "autoplay" ? "android" : "web",
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: ACCESS_TOKEN_HASH,
        },
      },
    };

    try {
      // Use centralized httpClient for connection pooling, but skip queue
      // for time-sensitive ad-blocking requests (we need fast response)
      const response = await httpClient.fetch(
        "https://gql.twitch.tv/gql",
        {
          method: "POST",
          headers: {
            "Client-ID": GQL_CLIENT_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        {
          // Do NOT skip queue - even though time-sensitive, we must respect the concurrency limit
          // because tryGetBackupStream fires 5 requests in parallel per stream.
          // 4 streams * 5 types = 20 concurrent requests = ECONNRESET
          skipQueue: false,
          // Aggressive timeout for streaming
          timeoutMs: TwitchManifestProxyService.FETCH_TIMEOUT,
          // Minimal retries - we have multiple player types as fallback
          maxRetries: 1,
          baseDelayMs: 200,
        }
      );

      if (!response.ok) {
        logger.debug("Service:TwitchManifest", "GQL request failed", {
          status: response.status,
          playerType,
        });
        return null;
      }

      const data = await response.json();
      const token = data.data?.streamPlaybackAccessToken;

      if (!token) return null;

      // Strip parent_domains to bypass embed detection (see method documentation above)
      try {
        const tokenValue = JSON.parse(token.value);
        delete tokenValue.parent_domains;
        delete tokenValue.parent_referrer_domains;
        return {
          signature: token.signature,
          value: JSON.stringify(tokenValue),
        };
      } catch {
        return token;
      }
    } catch (error) {
      logger.debug("Service:TwitchManifest", "GQL request exception", {
        playerType,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return null;
    }
  }

  /**
   * Build usher URL for backup stream
   */
  private buildUsherUrl(
    streamInfo: ProxyStreamInfo,
    accessToken: { signature: string; value: string }
  ): string {
    const baseUrl = `https://usher.ttvnw.net/api/channel/hls/${streamInfo.channelName}.m3u8`;
    const url = new URL(baseUrl + streamInfo.usherParams);
    url.searchParams.set("sig", accessToken.signature);
    url.searchParams.set("token", accessToken.value);

    // Strip tracking params
    url.searchParams.delete("parent_domains");
    url.searchParams.delete("referrer");

    return url.href;
  }

  /**
   * Get matching stream URL from backup encodings
   */
  private getMatchingStreamUrl(
    encodingsM3u8: string,
    originalUrl: string,
    streamInfo: ProxyStreamInfo
  ): string | null {
    const originalRes = streamInfo.resolutions.get(originalUrl);
    if (!originalRes) return null;

    const lines = encodingsM3u8.split("\n");
    let bestMatch: { url: string; score: number } | null = null;

    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const attrs = this.parseAttributes(lines[i]);
        const resolution = attrs.RESOLUTION;
        const bandwidth = parseInt(attrs.BANDWIDTH, 10);
        const streamUrl = lines[i + 1].trim();

        // Calculate match score
        const resMatch = resolution === originalRes.resolution ? 1000 : 0;
        const bwDiff = Math.abs(bandwidth - originalRes.bandwidth);
        const score = resMatch - bwDiff / 1000;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { url: streamUrl, score };
        }
      }
    }

    return bestMatch?.url || null;
  }

  /**
   * Check if segment URL is a known ad segment
   */
  private isKnownAdSegment(url: string): boolean {
    return (
      (url.includes("cloudfront.net") && url.includes("/ad/")) ||
      url.includes("amazon-ad") ||
      url.includes("stitched-ad")
    );
  }

  /**
   * Parse #EXT-X-STREAM-INF attributes
   */
  private parseAttributes(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const matches = line.matchAll(/([A-Z-]+)=("[^"]*"|[^,\s]*)/g);
    for (const match of matches) {
      attrs[match[1]] = match[2].replace(/"/g, "");
    }
    return attrs;
  }

  /**
   * Extract channel name from URL
   */
  private extractChannelName(url: string): string | null {
    const match = url.match(/\/channel\/(?:hls\/)?([^/.]+)\.m3u8/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Find stream info by media playlist URL
   */
  private findStreamInfoByUrl(url: string): ProxyStreamInfo | null {
    for (const streamInfo of this.streamInfos.values()) {
      for (const streamUrl of streamInfo.resolutions.keys()) {
        if (url.includes(streamUrl) || streamUrl.includes(url)) {
          return streamInfo;
        }
      }
    }
    return null;
  }

  // ========== Public API ==========

  enable(): void {
    this.isEnabled = true;
    logger.debug("Service:TwitchManifest", "Enabled");
  }

  disable(): void {
    this.isEnabled = false;
    logger.debug("Service:TwitchManifest", "Disabled");
  }

  isActive(): boolean {
    return this.isEnabled && this.isRegistered;
  }

  getStats(): ProxyStats {
    return { ...this.stats };
  }
}

export const twitchManifestProxy = new TwitchManifestProxyService();
