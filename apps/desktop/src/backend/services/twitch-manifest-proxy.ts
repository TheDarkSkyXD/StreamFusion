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
import {
  createTwitchPlaylistAdDetector,
  type TwitchPlaylistAdDetection,
} from "@/lib/twitch-playlist-ad-detection";
import {
  findTwitchPlaylistAlignment,
  keepTwitchBackupRenditions,
  rankTwitchRenditionCandidates,
  rankTwitchRenditions,
  type TwitchRendition,
} from "@/lib/twitch-rendition-continuity";
import { holdUnsafeTwitchMediaPlaylist } from "@/lib/twitch-unsafe-media-hold";
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
  isInAdBreak: boolean;
  usherParams: string;
  resolutions: Map<string, ResolutionInfo>;
  lastKnownBitrate: number | null;
  detectionScopes: Set<string>;
  backupMastersPromise: Promise<BackupMaster[]> | null;
  candidateStates: Map<string, ProxyCandidateState>;
  servedBackups: Map<string, PreparedBackup>;
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

interface BackupMaster {
  playerType: PlayerType;
  playlist: string;
}

interface PreparedBackup {
  playerType: PlayerType;
  rendition: TwitchRendition;
  playlist: string;
}

interface ProxyCandidateState {
  candidatePromise: Promise<void> | null;
  readyCandidate: PreparedBackup | null;
  consecutiveMisses: number;
  nextRetryAt: number;
}

const BACKUP_MISS_RETRY_BASE_MS = 2_000;
const BACKUP_MISS_RETRY_MAX_MS = 10_000;

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
  private playlistAdDetector = createTwitchPlaylistAdDetector();
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
    const normalizedChannel = channelName.toLowerCase();
    const streamInfo = this.streamInfos.get(normalizedChannel);
    streamInfo?.detectionScopes?.forEach((scope) => this.playlistAdDetector.clear(scope));
    this.streamInfos.delete(normalizedChannel);
  }

  /**
   * Clear all stream infos (called on cleanup)
   */
  clearAllStreamInfos(): void {
    this.streamInfos.clear();
    this.playlistAdDetector.clearAll();
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
   * Process master playlist and extract rendition metadata.
   */
  private processMasterPlaylist(url: string, text: string): string {
    const channelName = this.extractChannelName(url);
    if (!channelName) return text;

    const urlObj = new URL(url);
    this.clearStreamInfo(channelName);
    const streamInfo: ProxyStreamInfo = {
      channelName,
      encodingsM3u8: text,
      isInAdBreak: false,
      usherParams: urlObj.search,
      resolutions: new Map(),
      lastKnownBitrate: null,
      detectionScopes: new Set(),
      backupMastersPromise: null,
      candidateStates: new Map(),
      servedBackups: new Map(),
    };

    // Parse renditions used to preserve the active quality during backup selection.
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
    if (!streamInfo) {
      const detection = this.analyzeAds(text, "unowned-twitch-media");
      if (!detection.hasAds) return text;

      this.stats.adsDetected++;
      logger.warn("Service:TwitchManifest", "Holding unsafe media without a registered owner", {
        outcome: "unowned-unsafe-hold",
        ...detection.diagnostic,
      });
      return holdUnsafeTwitchMediaPlaylist(text);
    }

    // Neutralize tracking URLs first
    text = this.neutralizeTrackingUrls(text);

    // Detect ads using multiple heuristics
    const detectionScope = this.getDetectionScope(streamInfo, url);
    streamInfo.detectionScopes.add(detectionScope);
    const detection = this.analyzeAds(text, detectionScope);
    const hasAd = detection.hasAds;

    if (detection.verdict !== "clean") {
      logger.debug("Service:TwitchManifest", "Playlist ad classification", {
        ...detection.diagnostic,
      });
    }

    if (hasAd) {
      this.stats.adsDetected++;

      if (!streamInfo.isInAdBreak) {
        streamInfo.isInAdBreak = true;
        logger.debug("Service:TwitchManifest", "Ad detected", {
          channelName: streamInfo.channelName,
        });
      }

      // Try backup stream first
      const backupText = await this.tryGetBackupStream(streamInfo, url, text);
      if (backupText) {
        this.stats.backupsFetched++;
        return backupText;
      }
      logger.debug("Service:TwitchManifest", "No verified clean backup; holding unsafe media", {
        outcome: "unsafe-hold",
        ...detection.diagnostic,
      });
      return holdUnsafeTwitchMediaPlaylist(text);
    } else if (detection.verdict === "clean" && streamInfo.isInAdBreak) {
      const servedBackup = streamInfo.servedBackups.get(detectionScope);
      if (servedBackup && !findTwitchPlaylistAlignment(servedBackup.playlist, text)) {
        logger.debug("Service:TwitchManifest", "Clean original requires refreshed playback handoff", {
          outcome: "refresh-unaligned",
          ...detection.diagnostic,
        });
      }
      streamInfo.servedBackups.delete(detectionScope);
      streamInfo.candidateStates.delete(detectionScope);
      streamInfo.isInAdBreak = false;
      logger.debug("Service:TwitchManifest", "Ad ended", {
        channelName: streamInfo.channelName,
      });
    }

    return text;
  }

  /**
   * Detect ads using multiple heuristics
   * Uses dynamic patterns from VAFT pattern service when available
   */
  private analyzeAds(text: string, scopeId: string): TwitchPlaylistAdDetection {
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

    return this.playlistAdDetector.analyze(scopeId, text, {
      dateRangePatterns,
      adSignifiers,
    });
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

  private async loadBackupMaster(
    streamInfo: ProxyStreamInfo,
    playerType: PlayerType
  ): Promise<BackupMaster | null> {
    try {
      const token = await this.getAccessToken(streamInfo.channelName, playerType);
      if (!token) return null;
      const usherUrl = this.buildUsherUrl(streamInfo, token);
      const encodingsResponse = await this.fetchWithRetry(usherUrl);
      if (!encodingsResponse.ok) return null;
      return { playerType, playlist: await encodingsResponse.text() };
    } catch {
      return null;
    }
  }

  private async loadBackupMasters(streamInfo: ProxyStreamInfo): Promise<BackupMaster[]> {
    const results = await Promise.all(
      BACKUP_PLAYER_TYPES.map((playerType) => this.loadBackupMaster(streamInfo, playerType))
    );
    return results.filter((result): result is BackupMaster => result !== null);
  }

  private getOrStartBackupMasterPreload(streamInfo: ProxyStreamInfo): Promise<BackupMaster[]> {
    if (!streamInfo.backupMastersPromise) {
      const mastersPromise = this.loadBackupMasters(streamInfo);
      streamInfo.backupMastersPromise = mastersPromise;
      void mastersPromise
        .then((masters) => {
          if (masters.length === 0 && streamInfo.backupMastersPromise === mastersPromise) {
            streamInfo.backupMastersPromise = null;
          }
        })
        .catch(() => {
          if (streamInfo.backupMastersPromise === mastersPromise) {
            streamInfo.backupMastersPromise = null;
          }
        });
    }
    return streamInfo.backupMastersPromise;
  }

  private getCandidateState(streamInfo: ProxyStreamInfo, scope: string): ProxyCandidateState {
    let state = streamInfo.candidateStates.get(scope);
    if (!state) {
      state = {
        candidatePromise: null,
        readyCandidate: null,
        consecutiveMisses: 0,
        nextRetryAt: 0,
      };
      streamInfo.candidateStates.set(scope, state);
    }
    return state;
  }

  private async prepareCleanBackup(
    streamInfo: ProxyStreamInfo,
    originalUrl: string,
    _activePlaylist: string | null,
    loadedMasters?: BackupMaster[]
  ): Promise<PreparedBackup | null> {
    const originalResolution = streamInfo.resolutions.get(originalUrl);
    if (!originalResolution) return null;
    const masters =
      loadedMasters ??
      (await (streamInfo.backupMastersPromise ?? this.loadBackupMasters(streamInfo)));
    const candidates = rankTwitchRenditionCandidates(
      keepTwitchBackupRenditions(
        masters.flatMap(({ playerType, playlist }) =>
          rankTwitchRenditions(playlist, originalResolution).map((rendition) => ({
            ...rendition,
            playerType,
            rendition,
          }))
        ),
        originalResolution
      ),
      originalResolution
    );

    for (const candidate of candidates) {
      try {
        const response = await this.fetchWithRetry(candidate.rendition.url);
        if (!response.ok) continue;
        const playlist = await response.text();
        const scope = `${this.getDetectionScope(streamInfo, originalUrl)}:backup:${candidate.playerType}:${candidate.rendition.resolution}:${candidate.rendition.frameRate}:${candidate.rendition.codecs}`;
        streamInfo.detectionScopes.add(scope);
        if (this.analyzeAds(playlist, scope).verdict !== "clean") continue;
        // Stitched prerolls use a separate media-sequence namespace (often
        // starting at zero). Exact rendition/codec matching plus a clean
        // classification are the safe admission checks during an ad. Timeline
        // alignment remains required when restoring the original feed.
        return {
          playerType: candidate.playerType,
          rendition: candidate.rendition,
          playlist,
        };
      } catch {
        continue;
      }
    }
    return null;
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
    originalUrl: string,
    activePlaylist: string
  ): Promise<string | null> {
    const scope = this.getDetectionScope(streamInfo, originalUrl);
    const state = this.getCandidateState(streamInfo, scope);
    const candidate = state.readyCandidate;
    if (candidate) {
      streamInfo.servedBackups.set(scope, candidate);
      return candidate.playlist;
    }

    if (candidate) state.readyCandidate = null;
    if (state.candidatePromise || Date.now() < state.nextRetryAt) return null;

    const candidatePromise = this.getOrStartBackupMasterPreload(streamInfo)
      .then((masters) => this.prepareCleanBackup(streamInfo, originalUrl, activePlaylist, masters))
      .then((prepared) => {
        if (this.streamInfos.get(streamInfo.channelName) !== streamInfo) return;
        if (prepared) {
          state.readyCandidate = prepared;
          state.consecutiveMisses = 0;
          state.nextRetryAt = 0;
          return;
        }

        state.consecutiveMisses += 1;
        state.nextRetryAt =
          Date.now() +
          Math.min(
            BACKUP_MISS_RETRY_BASE_MS * 2 ** (state.consecutiveMisses - 1),
            BACKUP_MISS_RETRY_MAX_MS
          );
      })
      .catch((error: unknown) => {
        if (this.streamInfos.get(streamInfo.channelName) !== streamInfo) return;
        state.consecutiveMisses += 1;
        state.nextRetryAt =
          Date.now() +
          Math.min(
            BACKUP_MISS_RETRY_BASE_MS * 2 ** (state.consecutiveMisses - 1),
            BACKUP_MISS_RETRY_MAX_MS
          );
        logger.debug("Service:TwitchManifest", "Backup candidate search deferred", {
          channelName: streamInfo.channelName,
          retryInMs: state.nextRetryAt - Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (state.candidatePromise === candidatePromise) state.candidatePromise = null;
      });

    state.candidatePromise = candidatePromise;
    return null;
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

  private getDetectionScope(streamInfo: ProxyStreamInfo, url: string): string {
    for (const [streamUrl, resolution] of streamInfo.resolutions) {
      if (url.includes(streamUrl) || streamUrl.includes(url)) {
        return `${streamInfo.channelName}:${resolution.resolution}:${resolution.frameRate}:${resolution.bandwidth}:${resolution.codecs}`;
      }
    }
    return `${streamInfo.channelName}:unknown`;
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
