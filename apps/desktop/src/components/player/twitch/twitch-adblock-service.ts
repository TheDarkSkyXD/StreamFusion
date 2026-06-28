/**
 * Twitch Ad-Block Service
 *
 * Client-side ad-blocking service based on VAFT (Video Ad-Block for Twitch).
 * This service processes HLS m3u8 playlists to detect and block ads.
 *
 * Key techniques:
 * 1. Detect ads via 'stitched' signifier in playlist
 * 2. Fetch backup streams with different playerType values
 * 3. Strip ad segments from playlist if backup unavailable
 *
 * @see https://github.com/pixeltris/TwitchAdSolutions
 */

import { logger } from "@/renderer/logging/logger";
import {
  type AccessTokenResponse,
  type AdBlockConfig,
  type AdBlockStatus,
  createStreamInfo,
  DEFAULT_AD_SIGNIFIERS,
  DEFAULT_ADBLOCK_CONFIG,
  DEFAULT_DATERANGE_PATTERNS,
  type PlayerType,
  type ResolutionInfo,
  type StreamInfo,
} from "@/shared/adblock-types";

/**
 * Cache for ad segment URLs to replace with blank video
 */
const adSegmentCache = new Map<string, number>();

/**
 * Stream info storage by channel name
 */
const streamInfos = new Map<string, StreamInfo>();

/**
 * Stream info lookup by m3u8 URL
 */
const streamInfosByUrl = new Map<string, StreamInfo>();

/**
 * Current ad-block configuration
 */
let config: AdBlockConfig = { ...DEFAULT_ADBLOCK_CONFIG };

/**
 * Status change callback
 */
let onStatusChange: ((status: AdBlockStatus) => void) | null = null;

/**
 * GQL Device ID for access token requests
 */
let gqlDeviceId: string | null = null;

/**
 * Authorization header for authenticated requests
 */
let authorizationHeader: string | undefined;

/**
 * Client integrity header
 */
let clientIntegrityHeader: string | null = null;

/**
 * Client version header (e.g., "6ae57bb4-6f63-485e-a17c-e366b8b8cd0e")
 */
let clientVersion: string | null = null;

/**
 * Client session ID header
 */
let clientSession: string | null = null;

/**
 * Whether using V2 API
 */
let useV2Api = false;

/**
 * Whether the main process manifest proxy is active
 * When active, we skip heavy processing and just track ad state for UI updates
 */
let isMainProcessProxyActive = false;

// ========== Public API ==========

/**
 * Initialize the ad-block service with configuration
 */
export function initAdBlockService(newConfig?: Partial<AdBlockConfig>): void {
  if (newConfig) {
    config = { ...DEFAULT_ADBLOCK_CONFIG, ...newConfig };
  }
  logger.debug("Adblock:TwitchService", "service initialized", { enabled: config.enabled });
}

/**
 * Update ad-block configuration
 */
export function updateAdBlockConfig(updates: Partial<AdBlockConfig>): void {
  config = { ...config, ...updates };
  logger.debug("Adblock:TwitchService", "config updated", { updates });
}

/**
 * Set status change callback
 */
export function setStatusChangeCallback(callback: (status: AdBlockStatus) => void): void {
  onStatusChange = callback;
}

/**
 * Set authentication headers for GQL requests
 */
export function setAuthHeaders(
  deviceId: string,
  authHeader?: string,
  integrityHeader?: string
): void {
  gqlDeviceId = deviceId;
  authorizationHeader = authHeader;
  clientIntegrityHeader = integrityHeader || null;
}

/**
 * Set client version and session headers for GQL requests
 * These are optional but improve Twitch API compatibility
 */
function setClientHeaders(version?: string, session?: string): void {
  clientVersion = version || null;
  clientSession = session || null;
}

/**
 * Check if ad-blocking is enabled
 */
export function isAdBlockEnabled(): boolean {
  return config.enabled;
}

/**
 * Get current ad-block configuration (for testing/debugging)
 */
export function getAdBlockConfig(): AdBlockConfig {
  return { ...config };
}

/**
 * Set whether the main process manifest proxy is active
 * When active, renderer-side processing is reduced to just tracking ad state
 */
function setMainProcessProxyActive(active: boolean): void {
  isMainProcessProxyActive = active;
  logger.debug("Adblock:TwitchService", "main process proxy state changed", {
    state: active ? "active" : "inactive",
  });
}

/**
 * Check if main process proxy is handling ad blocking
 */
function isMainProcessProxyEnabled(): boolean {
  return isMainProcessProxyActive;
}

/**
 * Get current ad-block status for a channel
 */
export function getAdBlockStatus(channelName: string): AdBlockStatus {
  const streamInfo = streamInfos.get(channelName.toLowerCase());
  return {
    isActive: config.enabled,
    isShowingAd: streamInfo?.isShowingAd ?? false,
    isMidroll: streamInfo?.isMidroll ?? false,
    isStrippingSegments: streamInfo?.isStrippingAdSegments ?? false,
    numStrippedSegments: streamInfo?.numStrippedAdSegments ?? 0,
    activePlayerType: streamInfo?.activeBackupPlayerType ?? null,
    channelName: streamInfo?.channelName ?? null,
    isUsingFallbackMode: streamInfo?.isUsingFallbackMode ?? false,
    adStartTime: streamInfo?.adStartTime ?? null,
  };
}

/**
 * Check if a URL is a cached ad segment (should be replaced with blank video)
 */
export function isAdSegment(url: string): boolean {
  return adSegmentCache.has(url);
}

/**
 * Get blank video data URL for ad segment replacement
 */
export function getBlankVideoDataUrl(): string {
  // Minimal valid MP4 with blank video/audio
  return "data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA";
}

/**
 * Clear stream info for a channel (e.g., when stream ends)
 * Also clears the backend manifest proxy's stream info to prevent memory leaks
 */
export function clearStreamInfo(channelName: string): void {
  const lowerName = channelName.toLowerCase();
  const streamInfo = streamInfos.get(lowerName);
  if (streamInfo) {
    // Clear URL mappings
    streamInfo.urls.forEach((_, url) => {
      streamInfosByUrl.delete(url);
    });
    streamInfos.delete(lowerName);
  }

  // Also clear backend manifest proxy's stream info
  // This prevents memory buildup in the main process
  // Guard against window not defined (e.g., in Node.js test environment)
  if (typeof window !== "undefined") {
    window.electronAPI?.adblock?.clearProxyStreamInfo?.(lowerName).catch((error: unknown) => {
      logger.debug("Adblock:TwitchService", "failed to clear backend stream info", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

// ========== Master Playlist Processing ==========

/**
 * Process master playlist (encodings m3u8) for a channel
 * Called when fetching from usher.ttvnw.net/api/channel/hls/{channel}.m3u8
 */
export async function processMasterPlaylist(
  url: string,
  text: string,
  channelName: string
): Promise<string> {
  if (!config.enabled) {
    return text;
  }

  // Check if using V2 API
  useV2Api = url.includes("/api/v2/");

  const lowerChannel = channelName.toLowerCase();
  let streamInfo = streamInfos.get(lowerChannel);

  // Extract server time for later replacement
  const serverTime = getServerTimeFromM3u8(text);

  // Check if cached encodings are still valid
  if (streamInfo?.encodingsM3U8) {
    const firstUrl = text.match(/^https:.*\.m3u8$/m)?.[0];
    if (firstUrl) {
      try {
        const response = await fetch(firstUrl, { method: "HEAD" });
        if (response.status !== 200) {
          // Cached encodings are dead (stream probably restarted)
          streamInfo = undefined;
        }
      } catch {
        streamInfo = undefined;
      }
    }
  }

  if (!streamInfo || !streamInfo.encodingsM3U8) {
    // Parse URL params
    const urlObj = new URL(url);
    const usherParams = urlObj.search;

    // Create new stream info
    streamInfo = createStreamInfo(lowerChannel, usherParams);
    streamInfo.encodingsM3U8 = text;
    streamInfos.set(lowerChannel, streamInfo);

    // Parse resolution info from playlist
    parseResolutionsFromPlaylist(text, streamInfo);

    // Check for HEVC and create modified m3u8 if needed
    if (shouldCreateModifiedPlaylist(streamInfo)) {
      streamInfo.modifiedM3U8 = createModifiedPlaylist(text, streamInfo);
    }
  }

  streamInfo.lastPlayerReload = Date.now();

  // Return appropriate playlist
  const resultPlaylist =
    streamInfo.isUsingModifiedM3U8 && streamInfo.modifiedM3U8
      ? streamInfo.modifiedM3U8
      : streamInfo.encodingsM3U8;

  return replaceServerTimeInM3u8(resultPlaylist, serverTime);
}

// ========== Media Playlist Processing ==========

/**
 * Neutralize ad tracking URLs in playlist to prevent tracking
 * This replaces ad-related URLs with a safe placeholder
 */
function neutralizeTrackingUrls(text: string): string {
  const safeUrl = "https://twitch.tv";
  return text
    .replace(/(X-TV-TWITCH-AD-URL=")[^"]*(")/g, `$1${safeUrl}$2`)
    .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/g, `$1${safeUrl}$2`)
    .replace(/(X-TV-TWITCH-AD-ROLL-TYPE=")[^"]*(")/g, `$1$2`);
}

/**
 * Detect ads using multiple heuristics:
 * 1. DATERANGE tags with ad-related class (99% reliable)
 * 2. 'stitched' signifier (VAFT method)
 * 3. Bitrate drop detection (optional secondary check)
 *
 * Uses patterns from DEFAULT_DATERANGE_PATTERNS which are updated by VAFT pattern service
 */
function detectAds(text: string, streamInfo: StreamInfo): { hasAds: boolean; method: string } {
  // Primary detection: #EXT-X-DATERANGE with ad indicators (most reliable)
  if (config.useDateRangeDetection) {
    if (text.includes("#EXT-X-DATERANGE")) {
      // Check all known DATERANGE patterns
      for (const pattern of DEFAULT_DATERANGE_PATTERNS) {
        if (text.includes(pattern)) {
          return { hasAds: true, method: "DATERANGE" };
        }
      }
    }
  }

  // Secondary detection: ad signifiers
  for (const signifier of DEFAULT_AD_SIGNIFIERS) {
    if (text.includes(signifier)) {
      return { hasAds: true, method: "signifier" };
    }
  }

  // Also check configured signifier (backward compatibility)
  if (text.includes(config.adSignifier)) {
    return { hasAds: true, method: "stitched" };
  }

  // Tertiary detection: Bitrate drop (optional)
  if (config.useBitrateDropDetection && streamInfo.lastKnownBitrate) {
    const bitrateMatch = text.match(/BANDWIDTH=(\d+)/);
    if (bitrateMatch) {
      const currentBitrate = parseInt(bitrateMatch[1], 10);
      const dropRatio = currentBitrate / streamInfo.lastKnownBitrate;
      if (dropRatio < 1 - config.bitrateDropThreshold) {
        return { hasAds: true, method: "bitrate-drop" };
      }
    }
  }

  return { hasAds: false, method: "none" };
}

/**
 * Update last known bitrate from clean playlist
 */
function updateBitrateBaseline(text: string, streamInfo: StreamInfo): void {
  if (!config.useBitrateDropDetection) return;

  // Only update from clean (non-ad) playlists
  // Check all known ad patterns
  for (const pattern of DEFAULT_DATERANGE_PATTERNS) {
    if (text.includes(pattern)) return;
  }
  for (const signifier of DEFAULT_AD_SIGNIFIERS) {
    if (text.includes(signifier)) return;
  }
  if (text.includes(config.adSignifier)) return;

  const bitrateMatch = text.match(/BANDWIDTH=(\d+)/);
  if (bitrateMatch) {
    streamInfo.lastKnownBitrate = parseInt(bitrateMatch[1], 10);
  }
}

/**
 * Process media playlist (quality-specific m3u8)
 * This is where we detect ads and swap to backup streams
 */
export async function processMediaPlaylist(url: string, text: string): Promise<string> {
  if (!config.enabled) {
    return text;
  }

  // If main process proxy is handling ad blocking, just track ad state for UI
  if (isMainProcessProxyActive) {
    const streamInfo = streamInfosByUrl.get(url.trim());
    if (streamInfo) {
      const { hasAds } = detectAds(text, streamInfo);
      if (hasAds && !streamInfo.isShowingAd) {
        streamInfo.isShowingAd = true;
        streamInfo.adStartTime = Date.now();
        streamInfo.isMidroll = text.includes('"MIDROLL"') || text.includes('"midroll"');
        logger.debug("Adblock:TwitchService", "ad state showing (proxy handling replacement)");
        notifyStatusChange(streamInfo);
      } else if (!hasAds && streamInfo.isShowingAd) {
        streamInfo.isShowingAd = false;
        streamInfo.adStartTime = null;
        streamInfo.isMidroll = false;
        logger.debug("Adblock:TwitchService", "ad state ended");
        notifyStatusChange(streamInfo);
      }
    }
    return text; // Proxy already processed the playlist
  }

  const streamInfo = streamInfosByUrl.get(url.trim());
  if (!streamInfo) {
    // Debug: Log when we can't find stream info (this was silently failing before)
    logger.debug("Adblock:TwitchService", "no stream info found for URL, skipping processing");
    return text;
  }

  // Neutralize tracking URLs early in the pipeline
  text = neutralizeTrackingUrls(text);

  // Use enhanced ad detection with multiple heuristics
  const { hasAds: hasAdTags, method: detectionMethod } = detectAds(text, streamInfo);

  if (hasAdTags) {
    // We're in an ad break
    streamInfo.isMidroll = text.includes('"MIDROLL"') || text.includes('"midroll"');

    if (!streamInfo.isShowingAd) {
      streamInfo.isShowingAd = true;
      streamInfo.adStartTime = Date.now();
      streamInfo.isUsingFallbackMode = false;
      logger.debug("Adblock:TwitchService", "ad detected", {
        channelName: streamInfo.channelName,
        midroll: streamInfo.isMidroll,
        method: detectionMethod,
      });
      notifyStatusChange(streamInfo);
    }

    // For preroll ads, try to consume ad segments to reduce ad duration
    if (!streamInfo.isMidroll) {
      await consumeAdSegment(text, streamInfo);
    }

    // Get current resolution info
    const currentResolution = streamInfo.urls.get(url.trim());
    if (!currentResolution) {
      logger.warn("Adblock:TwitchService", "missing resolution info for url", { url });
      return text;
    }

    // Check if we need to reload player for HEVC
    const isHevc =
      currentResolution.codecs.startsWith("hev") || currentResolution.codecs.startsWith("hvc");
    if ((isHevc && !config.skipPlayerReloadOnHevc) || config.alwaysReloadPlayerOnAd) {
      if (streamInfo.modifiedM3U8 && !streamInfo.isUsingModifiedM3U8) {
        streamInfo.isUsingModifiedM3U8 = true;
        streamInfo.lastPlayerReload = Date.now();
        // Signal player reload needed
        notifyPlayerReload("ad-started");
      }
    }

    // Try to get backup stream
    const backupResult = await tryGetBackupStream(streamInfo, currentResolution);

    if (backupResult) {
      text = backupResult;
      // Check if backup STILL has ads (needs stripping)
      const backupHasAds = backupResult.includes(config.adSignifier);
      streamInfo.isUsingFallbackMode = backupHasAds; // TRUE if we're stripping
      if (!backupHasAds) {
        logger.debug("Adblock:TwitchService", "using clean backup stream", {
          activeBackupPlayerType: streamInfo.activeBackupPlayerType,
        });
      } else {
        logger.debug("Adblock:TwitchService", "backup has ads, entering stripping/fallback mode");
        notifyStatusChange(streamInfo);
      }
    } else {
      // All backup types failed - enter fallback mode
      if (!streamInfo.isUsingFallbackMode) {
        streamInfo.isUsingFallbackMode = true;
        logger.debug("Adblock:TwitchService", "all backup types failed, entering fallback mode");
        notifyStatusChange(streamInfo);
      }
    }

    // Strip ad segments if enabled
    if (config.isAdStrippingEnabled || (isHevc && streamInfo.modifiedM3U8)) {
      text = stripAdSegments(text, isHevc && !!streamInfo.modifiedM3U8, streamInfo);
    }
  } else if (streamInfo.isShowingAd) {
    // Ad has ended
    logger.debug("Adblock:TwitchService", "ads finished", { channelName: streamInfo.channelName });
    streamInfo.isShowingAd = false;
    streamInfo.isStrippingAdSegments = false;
    streamInfo.numStrippedAdSegments = 0;
    streamInfo.activeBackupPlayerType = null;
    streamInfo.isUsingFallbackMode = false;
    streamInfo.adStartTime = null;

    // Update bitrate baseline now that we're showing clean content
    updateBitrateBaseline(text, streamInfo);

    if (streamInfo.isUsingModifiedM3U8 || config.reloadPlayerAfterAd) {
      streamInfo.isUsingModifiedM3U8 = false;
      streamInfo.lastPlayerReload = Date.now();
      notifyPlayerReload("ad-ended");
    } else {
      notifyPauseResume();
    }

    notifyStatusChange(streamInfo);
  }

  return text;
}

// ========== Backup Stream Fetching ==========

/**
 * Network timeout for backup stream fetch operations (milliseconds)
 * Aggressive timeout to prevent stream freezing when Twitch API is slow
 */
const BACKUP_FETCH_TIMEOUT = 2000;

/**
 * Fetch with timeout wrapper to prevent indefinite blocking
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = BACKUP_FETCH_TIMEOUT
): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Try a single player type for backup stream
 * Returns the clean m3u8 or null if failed/has ads
 */
async function tryPlayerType(
  streamInfo: StreamInfo,
  currentResolution: ResolutionInfo,
  playerType: PlayerType
): Promise<{ playerType: PlayerType; m3u8: string } | null> {
  try {
    // Check cache first
    let encodingsM3u8 = streamInfo.backupEncodingsCache.get(playerType);

    if (!encodingsM3u8) {
      const accessToken = await getAccessToken(streamInfo.channelName, playerType);
      if (!accessToken) return null;

      const usherUrl = buildUsherUrl(streamInfo.channelName, accessToken, streamInfo.usherParams);
      const response = await fetchWithTimeout(usherUrl);
      if (response.status !== 200) return null;

      encodingsM3u8 = await response.text();
      streamInfo.backupEncodingsCache.set(playerType, encodingsM3u8);
    }

    const streamUrl = getStreamUrlForResolution(encodingsM3u8, currentResolution);
    if (!streamUrl) return null;

    const response = await fetchWithTimeout(streamUrl);
    if (response.status !== 200) return null;

    const m3u8Text = await response.text();

    // Check if this backup is clean (no ads)
    if (!m3u8Text.includes(config.adSignifier)) {
      return { playerType, m3u8: m3u8Text };
    }

    // Even if it has ads, keep it as potential fallback
    return { playerType, m3u8: m3u8Text };
  } catch (err) {
    // Timeout or network error - fail fast, don't log excessively
    if ((err as Error).name !== "AbortError") {
      logger.debug("Adblock:TwitchService", "backup player type failed", {
        playerType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

/**
 * Try to get a backup stream without ads.
 *
 * Fires all player types concurrently but consumes their results in priority
 * order so the highest-quality clean backup (backupPlayerTypes is ordered
 * Source-first) is returned as soon as it resolves, instead of waiting for the
 * slowest player type to settle.
 */
async function tryGetBackupStream(
  streamInfo: StreamInfo,
  currentResolution: ResolutionInfo
): Promise<string | null> {
  const isDoingMinimalRequests =
    streamInfo.lastPlayerReload > Date.now() - config.playerReloadMinimalRequestsTime;
  const startIndex = isDoingMinimalRequests ? config.playerReloadMinimalRequestsPlayerIndex : 0;
  const playerTypesToTry = config.backupPlayerTypes.slice(startIndex);

  // Start every player type in parallel...
  const backupPromises = playerTypesToTry.map((playerType) =>
    tryPlayerType(streamInfo, currentResolution, playerType)
  );

  // ...but consume them in priority order and return on the first clean hit.
  let fallbackResult: { playerType: PlayerType; m3u8: string } | null = null;
  let anyResult: { playerType: PlayerType; m3u8: string } | null = null;
  for (const promise of backupPromises) {
    const result = await promise;
    if (!result) continue;
    if (!anyResult) {
      anyResult = result;
    }
    if (!fallbackResult && result.playerType === config.fallbackPlayerType) {
      fallbackResult = result;
    }
    if (!result.m3u8.includes(config.adSignifier)) {
      streamInfo.activeBackupPlayerType = result.playerType;
      logger.debug("Adblock:TwitchService", "using clean backup", {
        playerType: result.playerType,
      });
      return result.m3u8;
    }
  }

  // No clean backup - prefer the configured fallback player type, else any result
  // we got (even with ads, for segment stripping).
  const chosen = fallbackResult ?? anyResult;
  if (chosen) {
    streamInfo.activeBackupPlayerType = chosen.playerType;
    return chosen.m3u8;
  }

  return null;
}

/**
 * Get access token with specified player type
 *
 * CRITICAL: Strips parent_domains from the token value to prevent Twitch
 * from detecting we're an "embedded" player and forcing ads on backup streams.
 */
async function getAccessToken(
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
      playerType: playerType,
      platform: playerType === "autoplay" ? "android" : "web",
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9",
      },
    },
  };

  try {
    const response = await gqlRequest(body);
    if (response.status === 200) {
      const data = (await response.json()) as AccessTokenResponse;
      const token = data.data.streamPlaybackAccessToken;

      if (token) {
        // CRITICAL: Strip parent_domains from token value to bypass fake ad detection
        // The token.value is a JSON string that contains embed detection params
        try {
          const tokenValue = JSON.parse(token.value);
          delete tokenValue.parent_domains;
          delete tokenValue.parent_referrer_domains;

          return {
            signature: token.signature,
            value: JSON.stringify(tokenValue),
          };
        } catch {
          // If JSON parsing fails, return original token
          return token;
        }
      }
    }
  } catch (err) {
    logger.debug("Adblock:TwitchService", "GQL request failed", {
      playerType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

/**
 * GQL request timeout (milliseconds)
 * Aggressive timeout to fail fast and prevent stream freezing
 */
const GQL_REQUEST_TIMEOUT = 2000;

/**
 * Make a GQL request with timeout to prevent blocking
 */
async function gqlRequest(body: object): Promise<Response> {
  // Generate device ID if not set
  if (!gqlDeviceId) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    gqlDeviceId = "";
    for (let i = 0; i < 32; i++) {
      gqlDeviceId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  const headers: Record<string, string> = {
    "Client-Id": config.clientId,
    "X-Device-Id": gqlDeviceId,
    "Content-Type": "application/json",
  };

  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  }
  if (clientIntegrityHeader) {
    headers["Client-Integrity"] = clientIntegrityHeader;
  }
  if (clientVersion) {
    headers["Client-Version"] = clientVersion;
  }
  if (clientSession) {
    headers["Client-Session-Id"] = clientSession;
  }

  return fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GQL_REQUEST_TIMEOUT),
  });
}

/**
 * Build usher URL for stream access
 *
 * CRITICAL: Strips parent_domains and referrer params to bypass embed detection
 */
function buildUsherUrl(
  channelName: string,
  accessToken: { signature: string; value: string },
  usherParams: string
): string {
  const baseUrl = `https://usher.ttvnw.net/api/${useV2Api ? "v2/" : ""}channel/hls/${channelName}.m3u8`;
  const url = new URL(baseUrl + usherParams);
  url.searchParams.set("sig", accessToken.signature);
  url.searchParams.set("token", accessToken.value);

  // CRITICAL: Strip tracking params that enable ad targeting/embed detection
  url.searchParams.delete("parent_domains");
  url.searchParams.delete("referrer");

  return url.href;
}

// ========== Ad Segment Stripping ==========

/**
 * Strip ad segments from playlist
 */
function stripAdSegments(text: string, stripAllSegments: boolean, streamInfo: StreamInfo): string {
  let hasStrippedAdSegments = false;
  const lines = text.replace(/\r/g, "").split("\n");
  const newAdUrl = "https://twitch.tv";

  let hasProgramDateTime = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      hasProgramDateTime = false;
    }
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME")) {
      hasProgramDateTime = true;
    }

    // Remove tracking URLs
    line = line
      .replace(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
      .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
    lines[i] = line;

    // Mark ad segments
    // Check if segment is live (has explicit tag OR falls under Program Date Time scope)
    const isLive = line.includes(",live") || hasProgramDateTime;

    if (
      i < lines.length - 1 &&
      line.startsWith("#EXTINF") &&
      !isLive &&
      (true || stripAllSegments)
    ) {
      const segmentUrl = lines[i + 1];
      if (!adSegmentCache.has(segmentUrl)) {
        streamInfo.numStrippedAdSegments++;
      }
      adSegmentCache.set(segmentUrl, Date.now());
      hasStrippedAdSegments = true;
    }

    if (line.includes(config.adSignifier)) {
      hasStrippedAdSegments = true;
    }
  }

  // Disable prefetch during ads
  if (hasStrippedAdSegments) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-TWITCH-PREFETCH:")) {
        lines[i] = "";
      }
    }
  } else {
    streamInfo.numStrippedAdSegments = 0;
  }

  streamInfo.isStrippingAdSegments = hasStrippedAdSegments;

  // Clean old entries from cache
  const now = Date.now();
  adSegmentCache.forEach((timestamp, key) => {
    if (timestamp < now - 120000) {
      adSegmentCache.delete(key);
    }
  });

  notifyStatusChange(streamInfo);

  return lines.join("\n");
}

/**
 * Consume ad segment to reduce ad duration
 */
async function consumeAdSegment(text: string, streamInfo: StreamInfo): Promise<void> {
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXTINF") && i + 1 < lines.length) {
      if (!line.includes(",live") && !streamInfo.requestedAds.has(lines[i + 1])) {
        streamInfo.requestedAds.add(lines[i + 1]);
        // Fetch in background to consume the ad
        fetch(lines[i + 1])
          .then((r) => r.blob())
          .catch(() => {});
        break;
      }
    }
  }
}

// ========== Playlist Parsing Utilities ==========

/**
 * Parse resolution info from master playlist
 */
function parseResolutionsFromPlaylist(text: string, streamInfo: StreamInfo): void {
  const lines = text.replace(/\r/g, "").split("\n");

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF") && lines[i + 1].includes(".m3u8")) {
      const attrs = parseAttributes(lines[i]);
      const resolution = attrs.RESOLUTION;
      if (resolution) {
        const resInfo: ResolutionInfo = {
          resolution,
          frameRate: parseFloat(attrs["FRAME-RATE"]) || 30,
          codecs: attrs.CODECS || "",
          url: lines[i + 1].trim(),
        };
        streamInfo.urls.set(resInfo.url, resInfo);
        streamInfo.resolutionList.push(resInfo);
        streamInfosByUrl.set(resInfo.url, streamInfo);
      }
    }
  }
}

/**
 * Parse HLS playlist attributes
 */
function parseAttributes(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    result[match[1]] = match[2] ?? match[3];
  }
  return result;
}

/**
 * Get stream URL for a specific resolution from encodings playlist
 */
function getStreamUrlForResolution(
  encodingsM3u8: string,
  targetResolution: ResolutionInfo
): string | null {
  const lines = encodingsM3u8.replace(/\r/g, "").split("\n");
  const [targetWidth, targetHeight] = targetResolution.resolution.split("x").map(Number);

  let matchedUrl: string | null = null;
  let matchedFrameRate = false;
  let closestUrl: string | null = null;
  let closestDiff = Infinity;

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF") && lines[i + 1].includes(".m3u8")) {
      const attrs = parseAttributes(lines[i]);
      const resolution = attrs.RESOLUTION;
      const frameRate = parseFloat(attrs["FRAME-RATE"]) || 30;

      if (resolution) {
        if (resolution === targetResolution.resolution) {
          if (!matchedUrl || (!matchedFrameRate && frameRate === targetResolution.frameRate)) {
            matchedUrl = lines[i + 1].trim();
            matchedFrameRate = frameRate === targetResolution.frameRate;
            if (matchedFrameRate) {
              return matchedUrl;
            }
          }
        }

        const [width, height] = resolution.split("x").map(Number);
        const diff = Math.abs(width * height - targetWidth * targetHeight);
        if (diff < closestDiff) {
          closestUrl = lines[i + 1].trim();
          closestDiff = diff;
        }
      }
    }
  }

  return matchedUrl || closestUrl;
}

/**
 * Get server time from m3u8
 */
function getServerTimeFromM3u8(text: string): string | null {
  if (useV2Api) {
    const match = text.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
    return match?.[1] ?? null;
  }
  const match = text.match(/SERVER-TIME="([0-9.]+)"/);
  return match?.[1] ?? null;
}

/**
 * Replace server time in m3u8
 */
function replaceServerTimeInM3u8(text: string, newServerTime: string | null): string {
  if (!newServerTime) return text;

  if (useV2Api) {
    return text.replace(
      /(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/,
      `$1${newServerTime}$2`
    );
  }
  return text.replace(/(SERVER-TIME=")[0-9.]+(")/, `$1${newServerTime}$2`);
}

// ========== HEVC Handling ==========

/**
 * Check if we should create a modified playlist for HEVC streams
 */
function shouldCreateModifiedPlaylist(streamInfo: StreamInfo): boolean {
  if (config.alwaysReloadPlayerOnAd) return true;

  const hasHevc = streamInfo.resolutionList.some(
    (r) => r.codecs.startsWith("hev") || r.codecs.startsWith("hvc")
  );
  const hasNonHevc = streamInfo.resolutionList.some(
    (r) => r.codecs.startsWith("avc") || r.codecs.startsWith("av0")
  );

  return hasHevc && hasNonHevc && !config.skipPlayerReloadOnHevc;
}

/**
 * Create modified playlist that swaps HEVC streams to AVC equivalents
 */
function createModifiedPlaylist(text: string, streamInfo: StreamInfo): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const nonHevcList = streamInfo.resolutionList.filter(
    (r) => r.codecs.startsWith("avc") || r.codecs.startsWith("av0")
  );

  if (nonHevcList.length === 0) return text;

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const attrs = parseAttributes(lines[i]);
      const codecs = attrs.CODECS || "";

      if (codecs.startsWith("hev") || codecs.startsWith("hvc")) {
        const resolution = attrs.RESOLUTION;
        const [targetWidth, targetHeight] = resolution.split("x").map(Number);

        // Find closest non-HEVC resolution
        const replacement = nonHevcList.sort((a, b) => {
          const [aW, aH] = a.resolution.split("x").map(Number);
          const [bW, bH] = b.resolution.split("x").map(Number);
          return (
            Math.abs(aW * aH - targetWidth * targetHeight) -
            Math.abs(bW * bH - targetWidth * targetHeight)
          );
        })[0];

        if (replacement) {
          logger.debug("Adblock:TwitchService", "modifiedM3U8 codec swap", {
            from: codecs,
            to: replacement.codecs,
          });
          lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${replacement.codecs}"`);
          lines[i + 1] = replacement.url + " ".repeat(i + 1); // Unique URL
        }
      }
    }
  }

  return lines.join("\n");
}

// ========== Status Notifications ==========

/**
 * Notify status change
 */
function notifyStatusChange(streamInfo: StreamInfo): void {
  if (onStatusChange) {
    onStatusChange({
      isActive: config.enabled,
      isShowingAd: streamInfo.isShowingAd,
      isMidroll: streamInfo.isMidroll,
      isStrippingSegments: streamInfo.isStrippingAdSegments,
      numStrippedSegments: streamInfo.numStrippedAdSegments,
      activePlayerType: streamInfo.activeBackupPlayerType,
      channelName: streamInfo.channelName,
      isUsingFallbackMode: streamInfo.isUsingFallbackMode,
      adStartTime: streamInfo.adStartTime,
    });
  }
}

// Callbacks for player control (to be set by HLS player)
export type PlayerReloadReason = "ad-started" | "ad-ended";

let onPlayerReload: ((reason: PlayerReloadReason) => void) | null = null;
let onPauseResume: (() => void) | null = null;

export function setPlayerCallbacks(
  reloadCallback: (reason: PlayerReloadReason) => void,
  pauseResumeCallback: () => void
): void {
  onPlayerReload = reloadCallback;
  onPauseResume = pauseResumeCallback;
}

function notifyPlayerReload(reason: PlayerReloadReason): void {
  if (onPlayerReload) {
    onPlayerReload(reason);
  }
}

function notifyPauseResume(): void {
  if (onPauseResume) {
    onPauseResume();
  }
}
