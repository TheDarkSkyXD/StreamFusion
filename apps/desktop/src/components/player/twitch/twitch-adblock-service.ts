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

const playlistAdDetector = createTwitchPlaylistAdDetector();
const detectionScopesByChannel = new Map<string, Set<string>>();

interface PreparedBackup {
  playerType: PlayerType;
  rendition: TwitchRendition;
  playlist: string;
}

interface RenditionSwitchState {
  candidatePromise: Promise<void> | null;
  readyCandidate: PreparedBackup | null;
  servedBackup: PreparedBackup | null;
  refreshPromise: Promise<void> | null;
  readyRefresh: PreparedBackup | null;
  consecutiveRefreshFailures: number;
  consecutiveOriginalCleanPolls: number;
  originalCleanSince: number | null;
  consecutiveMisses: number;
  nextRetryAt: number;
}

const renditionSwitchStates = new Map<string, RenditionSwitchState>();
const backupMasterPromises = new Map<string, Promise<BackupMaster[]>>();

const BACKUP_MISS_RETRY_BASE_MS = 2_000;
const BACKUP_MISS_RETRY_MAX_MS = 10_000;
const BACKUP_REFRESH_FAILURE_LIMIT = 2;
const ORIGINAL_CLEAN_CONFIRMATION_POLLS = 2;
// Twitch can briefly expose clean playlists between ads in the same pod. The
// verified backup is already live content, so favor continuity over an eager
// source handoff that may be reversed seconds later.
const ORIGINAL_CLEAN_STABILITY_MS = 20_000;
const PLAYER_RELOAD_GUARD_RELEASE_MS = 5_000;

const missingResolutionFallbackLoggedChannels = new Set<string>();

/**
 * Current ad-block configuration
 */
let config: AdBlockConfig = { ...DEFAULT_ADBLOCK_CONFIG };

/**
 * Status change callback
 */
let onStatusChange: ((status: AdBlockStatus) => void) | null = null;
const statusChangeSubscribers = new Map<string, Set<(status: AdBlockStatus) => void>>();

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

function canonicalizePlaylistUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function findStreamInfoForMediaUrl(url: string, channelName?: string): StreamInfo | null {
  const trimmedUrl = url.trim();
  const exactMatch = streamInfosByUrl.get(trimmedUrl);
  if (exactMatch) {
    return exactMatch;
  }

  const canonicalUrl = canonicalizePlaylistUrl(trimmedUrl);
  if (canonicalUrl) {
    for (const [knownUrl, streamInfo] of streamInfosByUrl) {
      if (canonicalizePlaylistUrl(knownUrl) === canonicalUrl) {
        streamInfosByUrl.set(trimmedUrl, streamInfo);
        return streamInfo;
      }
    }
  }

  const explicitOwner = channelName ? streamInfos.get(channelName.trim().toLowerCase()) : null;
  if (explicitOwner) {
    streamInfosByUrl.set(trimmedUrl, explicitOwner);
    return explicitOwner;
  }

  // Twitch can mutate media playlist query strings after the master playlist is
  // parsed. If only one stream is active, prefer processing that playlist over
  // silently letting a detected ad through.
  if (streamInfos.size === 1) {
    const [streamInfo] = streamInfos.values();
    streamInfosByUrl.set(trimmedUrl, streamInfo);
    return streamInfo;
  }

  return null;
}

function findResolutionInfoForMediaUrl(streamInfo: StreamInfo, url: string): ResolutionInfo | null {
  const trimmedUrl = url.trim();
  const exactMatch = streamInfo.urls.get(trimmedUrl);
  if (exactMatch) {
    return exactMatch;
  }

  const canonicalUrl = canonicalizePlaylistUrl(trimmedUrl);
  if (canonicalUrl) {
    for (const [knownUrl, resolution] of streamInfo.urls) {
      if (canonicalizePlaylistUrl(knownUrl) === canonicalUrl) {
        streamInfo.urls.set(trimmedUrl, resolution);
        return resolution;
      }
    }
  }

  if (streamInfo.urls.size === 1) {
    const [resolution] = streamInfo.urls.values();
    streamInfo.urls.set(trimmedUrl, resolution);
    return resolution;
  }

  if (streamInfos.size === 1 && streamInfo.resolutionList.length > 0) {
    const resolution = streamInfo.resolutionList[0];
    streamInfo.urls.set(trimmedUrl, resolution);
    return resolution;
  }

  return null;
}

function getRenditionScope(streamInfo: StreamInfo, resolution: ResolutionInfo): string {
  return `${streamInfo.channelName}:${resolution.resolution}:${resolution.frameRate}:${resolution.bandwidth}:${resolution.codecs}`;
}

function getRenditionSwitchState(scope: string): RenditionSwitchState {
  let state = renditionSwitchStates.get(scope);
  if (!state) {
    state = {
      candidatePromise: null,
      readyCandidate: null,
      servedBackup: null,
      refreshPromise: null,
      readyRefresh: null,
      consecutiveRefreshFailures: 0,
      consecutiveOriginalCleanPolls: 0,
      originalCleanSince: null,
      consecutiveMisses: 0,
      nextRetryAt: 0,
    };
    renditionSwitchStates.set(scope, state);
  }
  return state;
}

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

export function subscribeAdBlockStatus(
  channelName: string,
  callback: (status: AdBlockStatus) => void
): () => void {
  const channel = channelName.trim().toLowerCase();
  const subscribers = statusChangeSubscribers.get(channel) ?? new Set();
  subscribers.add(callback);
  statusChangeSubscribers.set(channel, subscribers);

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      statusChangeSubscribers.delete(channel);
    }
  };
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

function clearStreamMetadata(channelName: string): void {
  const lowerName = channelName.toLowerCase();
  backupMasterPromises.delete(lowerName);
  const streamInfo = streamInfos.get(lowerName);
  if (streamInfo) {
    streamInfo.urls.forEach((_, url) => {
      streamInfosByUrl.delete(url);
    });
    streamInfos.delete(lowerName);
    missingResolutionFallbackLoggedChannels.delete(lowerName);
  }
  detectionScopesByChannel.get(lowerName)?.forEach((scope) => playlistAdDetector.clear(scope));
  detectionScopesByChannel.delete(lowerName);
}

/**
 * Clear stream info for a channel (e.g., when stream ends)
 * Also clears the backend manifest proxy's stream info to prevent memory leaks
 */
export function clearStreamInfo(
  channelName: string,
  options: { preservePlayerReloadGuard?: boolean } = {}
): void {
  const lowerName = channelName.toLowerCase();
  clearStreamMetadata(lowerName);
  if (!options.preservePlayerReloadGuard) resetPlayerReloadGuard(lowerName);
  for (const scope of renditionSwitchStates.keys()) {
    if (scope.startsWith(`${lowerName}:`)) renditionSwitchStates.delete(scope);
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
  channelName: string,
  playlistBaseUrl: string = url
): Promise<string> {
  if (!config.enabled) {
    return text;
  }

  // Check if using V2 API
  useV2Api = url.includes("/api/v2/");

  const lowerChannel = channelName.toLowerCase();
  let streamInfo = streamInfos.get(lowerChannel);

  if (streamInfo?.encodingsM3U8 && streamInfo.encodingsM3U8 !== text) {
    // Twitch rotates signed rendition URLs whenever HLS.js reloads the
    // master. Replace only URL-bound metadata here: a verified clean backup
    // belongs to the channel/rendition scope and must survive long enough for
    // the first media request after the reload to consume it.
    clearStreamMetadata(lowerChannel);
    streamInfo = undefined;
  }

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
          clearStreamInfo(lowerChannel, { preservePlayerReloadGuard: true });
          streamInfo = undefined;
        }
      } catch {
        clearStreamInfo(lowerChannel, { preservePlayerReloadGuard: true });
        streamInfo = undefined;
      }
    }
  }

  if (!streamInfo || !streamInfo.encodingsM3U8) {
    // Parse URL params
    const urlObj = new URL(url, playlistBaseUrl);
    const usherParams = urlObj.search;

    // Create new stream info
    streamInfo = createStreamInfo(lowerChannel, usherParams);
    streamInfo.encodingsM3U8 = text;
    streamInfos.set(lowerChannel, streamInfo);

    // Parse resolution info from playlist
    parseResolutionsFromPlaylist(text, streamInfo, playlistBaseUrl);

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
function detectAds(
  text: string,
  streamInfo: StreamInfo,
  mediaUrl: string
): TwitchPlaylistAdDetection & { method: string } {
  const scope = getPlaylistDetectionScope(streamInfo, mediaUrl);
  let channelScopes = detectionScopesByChannel.get(streamInfo.channelName);
  if (!channelScopes) {
    channelScopes = new Set();
    detectionScopesByChannel.set(streamInfo.channelName, channelScopes);
  }
  channelScopes.add(scope);

  const bitrateMatch = text.match(/BANDWIDTH=(\d+)/);
  const currentBitrate = bitrateMatch ? Number.parseInt(bitrateMatch[1], 10) : null;
  const detection = playlistAdDetector.analyze(scope, text, {
    dateRangePatterns: DEFAULT_DATERANGE_PATTERNS,
    adSignifiers: Array.from(new Set([...DEFAULT_AD_SIGNIFIERS, config.adSignifier])),
    useDateRangeDetection: config.useDateRangeDetection,
    bitrate:
      config.useBitrateDropDetection && streamInfo.lastKnownBitrate && currentBitrate
        ? {
            current: currentBitrate,
            previous: streamInfo.lastKnownBitrate,
            dropThreshold: config.bitrateDropThreshold,
          }
        : undefined,
  });

  if (detection.verdict !== "clean") {
    logger.debug("Adblock:TwitchService", "playlist ad classification", {
      ...detection.diagnostic,
    });
  }

  return { ...detection, method: detection.reasons[0] ?? "none" };
}

function getPlaylistDetectionScope(streamInfo: StreamInfo, mediaUrl: string): string {
  const resolution = findResolutionInfoForMediaUrl(streamInfo, mediaUrl);
  return resolution
    ? getRenditionScope(streamInfo, resolution)
    : `${streamInfo.channelName}:unknown`;
}

function promotePlaylistDetectionBaseline(
  text: string,
  streamInfo: StreamInfo,
  mediaUrl: string
): void {
  playlistAdDetector.clear(getPlaylistDetectionScope(streamInfo, mediaUrl));
  detectAds(text, streamInfo, mediaUrl);
}

function isExplicitCueInRecovery(text: string, detection: TwitchPlaylistAdDetection): boolean {
  if (detection.verdict !== "suspected") return false;

  const hasCueIn = text
    .replace(/\r/g, "")
    .split("\n")
    .some((line) => line.trim() === "#EXT-X-CUE-IN");
  if (!hasCueIn) return false;

  return detection.reasons.every(
    (reason) =>
      reason === "discontinuity" ||
      reason === "host-transition" ||
      reason === "sequence-transition" ||
      reason === "timing-transition"
  );
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
export async function processMediaPlaylist(
  url: string,
  text: string,
  channelName?: string
): Promise<string> {
  if (!config.enabled) {
    return text;
  }

  // If main process proxy is handling ad blocking, just track ad state for UI
  if (isMainProcessProxyActive) {
    const streamInfo = findStreamInfoForMediaUrl(url, channelName);
    if (streamInfo) {
      const detection = detectAds(text, streamInfo, url);
      const { hasAds } = detection;
      const hasExplicitCueInRecovery = isExplicitCueInRecovery(text, detection);
      if (hasAds && !streamInfo.isShowingAd) {
        streamInfo.isShowingAd = true;
        streamInfo.adStartTime = Date.now();
        streamInfo.isMidroll = text.includes('"MIDROLL"') || text.includes('"midroll"');
        logger.debug("Adblock:TwitchService", "ad state showing (proxy handling replacement)");
        notifyStatusChange(streamInfo);
      } else if (
        (detection.verdict === "clean" || hasExplicitCueInRecovery) &&
        streamInfo.isShowingAd
      ) {
        if (hasExplicitCueInRecovery) {
          promotePlaylistDetectionBaseline(text, streamInfo, url);
        }
        streamInfo.isShowingAd = false;
        streamInfo.isMidroll = false;
        streamInfo.isStrippingAdSegments = false;
        streamInfo.numStrippedAdSegments = 0;
        streamInfo.activeBackupPlayerType = null;
        streamInfo.isUsingFallbackMode = false;
        streamInfo.adStartTime = null;
        logger.debug("Adblock:TwitchService", "ad state ended");
        notifyStatusChange(streamInfo);
      }
    }
    return text; // Proxy already processed the playlist
  }

  const streamInfo = findStreamInfoForMediaUrl(url, channelName);
  if (!streamInfo) {
    // Debug: Log when we can't find stream info (this was silently failing before)
    logger.debug("Adblock:TwitchService", "no stream info found for URL, skipping processing", {
      url,
    });
    return text;
  }

  // Neutralize tracking URLs early in the pipeline
  text = neutralizeTrackingUrls(text);

  // Use enhanced ad detection with multiple heuristics
  const detection = detectAds(text, streamInfo, url);
  const { hasAds: hasAdTags, method: detectionMethod } = detection;
  const hasExplicitCueInRecovery = isExplicitCueInRecovery(text, detection);

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
    }

    // For preroll ads, try to consume ad segments to reduce ad duration
    if (!streamInfo.isMidroll) {
      await consumeAdSegment(text, streamInfo);
    }

    // Get current resolution info
    const currentResolution = findResolutionInfoForMediaUrl(streamInfo, url);
    if (!currentResolution) {
      if (!missingResolutionFallbackLoggedChannels.has(streamInfo.channelName)) {
        missingResolutionFallbackLoggedChannels.add(streamInfo.channelName);
        logger.debug("Adblock:TwitchService", "missing resolution info; using stripping only", {
          channelName: streamInfo.channelName,
        });
      }
    }

    // Check if we need to reload player for HEVC
    const isHevc = currentResolution
      ? currentResolution.codecs.startsWith("hev") || currentResolution.codecs.startsWith("hvc")
      : false;
    if (
      currentResolution &&
      ((isHevc && !config.skipPlayerReloadOnHevc) || config.alwaysReloadPlayerOnAd)
    ) {
      if (streamInfo.modifiedM3U8 && !streamInfo.isUsingModifiedM3U8) {
        streamInfo.isUsingModifiedM3U8 = true;
        streamInfo.lastPlayerReload = Date.now();
        // Signal player reload needed
        notifyPlayerReload(streamInfo.channelName, "ad-started");
      }
    }

    // Try to get backup stream
    let backupResult: string | null = null;
    if (currentResolution) {
      const switchState = getRenditionSwitchState(
        getRenditionScope(streamInfo, currentResolution)
      );
      switchState.consecutiveOriginalCleanPolls = 0;
      switchState.originalCleanSince = null;
      backupResult =
        getServedBackupOrScheduleRefresh(streamInfo, currentResolution) ??
        tryGetReadyBackupOrScheduleSearch(streamInfo, currentResolution, text);
    }

    if (backupResult) {
      text = backupResult;
      streamInfo.isStrippingAdSegments = false;
      streamInfo.numStrippedAdSegments = 0;
      streamInfo.isUsingFallbackMode = false;
      logger.debug("Adblock:TwitchService", "using verified clean backup stream", {
        activeBackupPlayerType: streamInfo.activeBackupPlayerType,
      });
      notifyStatusChange(streamInfo);
    } else {
      streamInfo.isUsingFallbackMode = true;
      text = stripAdSegments(text, false, streamInfo);
      text = holdUnsafeTwitchMediaPlaylist(text);
      logger.debug("Adblock:TwitchService", "no verified clean backup; holding unsafe media", {
        outcome: "unsafe-hold",
        ...detection.diagnostic,
      });
      return text;
    }
  } else if (
    (detection.verdict === "clean" || hasExplicitCueInRecovery) &&
    streamInfo.isShowingAd
  ) {
    const currentResolution = findResolutionInfoForMediaUrl(streamInfo, url);
    const switchState = currentResolution
      ? getRenditionSwitchState(getRenditionScope(streamInfo, currentResolution))
      : null;
    const restoredFromBackup = Boolean(switchState?.servedBackup);
    if (
      switchState?.servedBackup &&
      detection.verdict === "clean" &&
      !hasExplicitCueInRecovery
    ) {
      const now = Date.now();
      switchState.originalCleanSince ??= now;
      switchState.consecutiveOriginalCleanPolls += 1;
      const cleanForMs = Math.max(0, now - switchState.originalCleanSince);
      const originalIsStable =
        switchState.consecutiveOriginalCleanPolls >= ORIGINAL_CLEAN_CONFIRMATION_POLLS &&
        cleanForMs >= ORIGINAL_CLEAN_STABILITY_MS;
      if (!originalIsStable) {
        const continuedBackup = currentResolution
          ? getServedBackupOrScheduleRefresh(streamInfo, currentResolution)
          : null;
        if (continuedBackup) {
          logger.debug(
            "Adblock:TwitchService",
            "holding active backup for clean-original confirmation",
            {
              channelName: streamInfo.channelName,
              confirmationPolls: switchState.consecutiveOriginalCleanPolls,
              cleanForMs,
              requiredCleanMs: ORIGINAL_CLEAN_STABILITY_MS,
            }
          );
          return continuedBackup;
        }
      }
    }
    if (
      switchState?.servedBackup &&
      !findTwitchPlaylistAlignment(switchState.servedBackup.playlist, text)
    ) {
      logger.debug("Adblock:TwitchService", "clean original requires refreshed playback handoff", {
        outcome: "refresh-unaligned",
        ...detection.diagnostic,
      });
    }
    if (switchState) {
      if (switchState.readyRefresh) {
        switchState.servedBackup = switchState.readyRefresh;
        switchState.readyRefresh = null;
      }
      switchState.readyCandidate = null;
      switchState.consecutiveRefreshFailures = 0;
      switchState.consecutiveOriginalCleanPolls = 0;
      switchState.originalCleanSince = null;
      switchState.consecutiveMisses = 0;
      switchState.nextRetryAt = 0;
      if (switchState.servedBackup) {
        scheduleServedBackupRefresh(streamInfo, switchState);
      }
    }
    if (hasExplicitCueInRecovery) {
      promotePlaylistDetectionBaseline(text, streamInfo, url);
    }
    // Ad has ended
    logger.debug("Adblock:TwitchService", "ads finished", { channelName: streamInfo.channelName });
    streamInfo.isShowingAd = false;
    streamInfo.isMidroll = false;
    streamInfo.isStrippingAdSegments = false;
    streamInfo.numStrippedAdSegments = 0;
    streamInfo.activeBackupPlayerType = null;
    streamInfo.isUsingFallbackMode = false;
    streamInfo.adStartTime = null;

    // Update bitrate baseline now that we're showing clean content
    updateBitrateBaseline(text, streamInfo);

    if (restoredFromBackup || streamInfo.isUsingModifiedM3U8 || config.reloadPlayerAfterAd) {
      streamInfo.isUsingModifiedM3U8 = false;
      streamInfo.lastPlayerReload = Date.now();
      notifyPlayerReload(streamInfo.channelName, "ad-ended");
    } else {
      resetPlayerReloadGuard(streamInfo.channelName);
    }

    notifyStatusChange(streamInfo);
  } else if (streamInfo.isShowingAd) {
    const currentResolution = findResolutionInfoForMediaUrl(streamInfo, url);
    if (currentResolution) {
      const switchState = getRenditionSwitchState(
        getRenditionScope(streamInfo, currentResolution)
      );
      switchState.consecutiveOriginalCleanPolls = 0;
      switchState.originalCleanSince = null;
    }
  } else if (detection.verdict === "clean") {
    const currentResolution = findResolutionInfoForMediaUrl(streamInfo, url);
    if (currentResolution) {
      const switchState = getRenditionSwitchState(
        getRenditionScope(streamInfo, currentResolution)
      );
      if (switchState.readyRefresh) {
        switchState.servedBackup = switchState.readyRefresh;
        switchState.readyRefresh = null;
      }
      if (switchState.servedBackup) {
        scheduleServedBackupRefresh(streamInfo, switchState);
      } else {
        tryGetReadyBackupOrScheduleSearch(streamInfo, currentResolution, text, false);
      }
    }
  }

  return text;
}

// ========== Backup Stream Fetching ==========

/**
 * Network timeout for backup stream fetch operations (milliseconds)
 * Aggressive timeout to prevent stream freezing when Twitch API is slow
 */
const BACKUP_FETCH_TIMEOUT = 6000;

/**
 * Fetch with timeout wrapper to prevent indefinite blocking
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = BACKUP_FETCH_TIMEOUT
): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

interface BackupMaster {
  playerType: PlayerType;
  playlist: string;
}

async function loadBackupMaster(
  streamInfo: StreamInfo,
  playerType: PlayerType
): Promise<BackupMaster | null> {
  try {
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
    return { playerType, playlist: encodingsM3u8 };
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      logger.debug("Adblock:TwitchService", "backup player type failed", {
        playerType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

async function loadBackupMasters(streamInfo: StreamInfo): Promise<BackupMaster[]> {
  const results = await Promise.all(
    config.backupPlayerTypes.map((playerType) => loadBackupMaster(streamInfo, playerType))
  );
  return results.filter((result): result is BackupMaster => result !== null);
}

function getOrStartBackupMasterPreload(streamInfo: StreamInfo): Promise<BackupMaster[]> {
  let mastersPromise = backupMasterPromises.get(streamInfo.channelName);
  if (!mastersPromise) {
    mastersPromise = loadBackupMasters(streamInfo);
    backupMasterPromises.set(streamInfo.channelName, mastersPromise);
    void mastersPromise
      .then((masters) => {
        if (
          masters.length === 0 &&
          backupMasterPromises.get(streamInfo.channelName) === mastersPromise
        ) {
          backupMasterPromises.delete(streamInfo.channelName);
        }
      })
      .catch(() => {
        if (backupMasterPromises.get(streamInfo.channelName) === mastersPromise) {
          backupMasterPromises.delete(streamInfo.channelName);
        }
      });
  }
  return mastersPromise;
}

function analyzeBackupPlaylist(
  streamInfo: StreamInfo,
  candidate: { playerType: PlayerType; rendition: TwitchRendition },
  playlist: string
): TwitchPlaylistAdDetection {
  const variantScope = getRenditionScope(streamInfo, candidate.rendition);
  const scope = `${variantScope}:backup:${candidate.playerType}:${candidate.rendition.codecs}`;
  let channelScopes = detectionScopesByChannel.get(streamInfo.channelName);
  if (!channelScopes) {
    channelScopes = new Set();
    detectionScopesByChannel.set(streamInfo.channelName, channelScopes);
  }
  channelScopes.add(scope);
  return playlistAdDetector.analyze(scope, playlist, {
    dateRangePatterns: DEFAULT_DATERANGE_PATTERNS,
    adSignifiers: Array.from(new Set([...DEFAULT_AD_SIGNIFIERS, config.adSignifier])),
    useDateRangeDetection: config.useDateRangeDetection,
  });
}

function hasPlayableSegmentReference(playlist: string): boolean {
  const lines = playlist
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  let awaitingSegmentUri = false;
  let segmentIsGap = false;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
      if (line.slice("#EXT-X-TWITCH-PREFETCH:".length).trim()) return true;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      awaitingSegmentUri = true;
      segmentIsGap = false;
      continue;
    }
    if (!awaitingSegmentUri) continue;
    if (line === "#EXT-X-GAP") {
      segmentIsGap = true;
      continue;
    }
    if (line && !line.startsWith("#")) {
      if (!segmentIsGap) return true;
      awaitingSegmentUri = false;
    }
  }

  return false;
}

async function prepareCleanBackup(
  streamInfo: StreamInfo,
  currentResolution: ResolutionInfo,
  _activePlaylist: string | null,
  loadedMasters?: BackupMaster[]
): Promise<PreparedBackup | null> {
  const masters = loadedMasters ?? (await loadBackupMasters(streamInfo));
  const candidates = rankTwitchRenditionCandidates(
    keepTwitchBackupRenditions(
      masters.flatMap(({ playerType, playlist }) =>
        rankTwitchRenditions(playlist, currentResolution).map((rendition) => ({
          ...rendition,
          playerType,
          rendition,
        }))
      ),
      currentResolution
    ),
    currentResolution
  );

  if (candidates.length === 0) return null;

  const inspectCandidate = async (
    candidate: (typeof candidates)[number]
  ): Promise<PreparedBackup | null> => {
    try {
      const rendition = candidate.rendition;
      const response = await fetchWithTimeout(rendition.url);
      if (response.status !== 200) return null;
      const playlist = await response.text();
      if (!hasPlayableSegmentReference(playlist)) {
        logger.debug("Adblock:TwitchService", "backup candidate is not playable", {
          outcome: "unplayable-playlist",
          playerType: candidate.playerType,
          resolution: candidate.rendition.resolution,
        });
        return null;
      }
      const analysis = analyzeBackupPlaylist(streamInfo, candidate, playlist);
      logger.debug("Adblock:TwitchService", "inspected backup rendition", {
        playerType: candidate.playerType,
        resolution: candidate.rendition.resolution,
        verdict: analysis.verdict,
        fingerprint: analysis.diagnostic.fingerprint,
      });
      if (analysis.verdict !== "clean") return null;
      // Stitched prerolls use a separate media-sequence namespace (often
      // starting at zero). Rendition continuity plus a clean classification
      // are the safe admission checks during an ad. A transient startup level
      // below 480p is raised to the preferred fallback floor. A clean 360p
      // rendition is admitted only after every real 480p-or-better candidate
      // is confirmed ad-bearing; 160p is never used.
      return { playerType: candidate.playerType, rendition, playlist };
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        logger.debug("Adblock:TwitchService", "backup rendition failed", {
          playerType: candidate.playerType,
          resolution: candidate.rendition.resolution,
          frameRate: candidate.rendition.frameRate,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }
  };

  const firstCleanCandidate = (
    tier: typeof candidates
  ): Promise<PreparedBackup | null> =>
    new Promise((resolve) => {
      if (tier.length === 0) {
        resolve(null);
        return;
      }

      let remaining = tier.length;
      let settled = false;
      for (const candidate of tier) {
        void inspectCandidate(candidate).then((prepared) => {
          if (settled) return;
          if (prepared) {
            settled = true;
            resolve(prepared);
            return;
          }
          remaining -= 1;
          if (remaining === 0) resolve(null);
        });
      }
    });

  // Race identities within a quality tier so one slow edge cannot block the
  // others. Preserve the selected quality whenever any exact rendition is
  // clean, then try the real 480p-or-better floor. Only after both tiers fail
  // may a genuine 360p stream prevent a black screen; 160p is never selected.
  const exactCandidates = candidates.filter(
    (candidate) => candidate.rendition.resolution === currentResolution.resolution
  );
  const floorCandidates = candidates.filter(
    (candidate) => {
      const height = Number.parseInt(candidate.rendition.resolution.split("x")[1] ?? "", 10);
      return (
        candidate.rendition.resolution !== currentResolution.resolution && height >= 480
      );
    }
  );
  const emergencyCandidates = candidates.filter((candidate) => {
    const height = Number.parseInt(candidate.rendition.resolution.split("x")[1] ?? "", 10);
    return height >= 360 && height < 480;
  });
  return (
    (await firstCleanCandidate(exactCandidates)) ??
    (await firstCleanCandidate(floorCandidates)) ??
    firstCleanCandidate(emergencyCandidates)
  );
}

function invalidateServedBackup(
  streamInfo: StreamInfo,
  state: RenditionSwitchState,
  served: PreparedBackup
): void {
  if (
    streamInfos.get(streamInfo.channelName) !== streamInfo ||
    state.servedBackup !== served
  ) {
    return;
  }

  state.servedBackup = null;
  state.readyRefresh = null;
  state.consecutiveRefreshFailures = 0;
  state.consecutiveOriginalCleanPolls = 0;
  state.originalCleanSince = null;
  state.nextRetryAt = 0;
  streamInfo.activeBackupPlayerType = null;
  streamInfo.backupEncodingsCache.clear();
  backupMasterPromises.delete(streamInfo.channelName);
}

function recordBackupRefreshFailure(
  streamInfo: StreamInfo,
  state: RenditionSwitchState,
  served: PreparedBackup,
  details: Record<string, unknown>
): void {
  if (
    streamInfos.get(streamInfo.channelName) !== streamInfo ||
    state.servedBackup !== served
  ) {
    return;
  }

  state.consecutiveRefreshFailures += 1;
  logger.debug("Adblock:TwitchService", "active backup refresh deferred", {
    channelName: streamInfo.channelName,
    playerType: served.playerType,
    consecutiveFailures: state.consecutiveRefreshFailures,
    ...details,
  });
  if (state.consecutiveRefreshFailures >= BACKUP_REFRESH_FAILURE_LIMIT) {
    invalidateServedBackup(streamInfo, state, served);
  }
}

function scheduleServedBackupRefresh(
  streamInfo: StreamInfo,
  state: RenditionSwitchState
): void {
  const served = state.servedBackup;
  if (!served || state.refreshPromise) return;

  const refreshPromise = (async () => {
    try {
      const response = await fetchWithTimeout(served.rendition.url);
      if (response.status !== 200) {
        recordBackupRefreshFailure(streamInfo, state, served, { status: response.status });
        return;
      }

      const playlist = await response.text();
      if (!hasPlayableSegmentReference(playlist)) {
        recordBackupRefreshFailure(streamInfo, state, served, { outcome: "unplayable" });
        return;
      }

      const analysis = analyzeBackupPlaylist(streamInfo, served, playlist);
      if (analysis.verdict !== "clean") {
        logger.debug("Adblock:TwitchService", "active backup is no longer clean", {
          channelName: streamInfo.channelName,
          playerType: served.playerType,
          verdict: analysis.verdict,
          fingerprint: analysis.diagnostic.fingerprint,
        });
        invalidateServedBackup(streamInfo, state, served);
        return;
      }

      if (
        streamInfos.get(streamInfo.channelName) !== streamInfo ||
        state.servedBackup !== served
      ) {
        return;
      }
      state.readyRefresh = { ...served, playlist };
      state.consecutiveRefreshFailures = 0;
      logger.debug("Adblock:TwitchService", "prepared advancing clean backup", {
        channelName: streamInfo.channelName,
        playerType: served.playerType,
        resolution: served.rendition.resolution,
        mediaSequence: analysis.diagnostic.mediaSequence,
        fingerprint: analysis.diagnostic.fingerprint,
      });
    } catch (error: unknown) {
      recordBackupRefreshFailure(streamInfo, state, served, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })().finally(() => {
    if (state.refreshPromise === refreshPromise) state.refreshPromise = null;
  });
  state.refreshPromise = refreshPromise;
}

function getServedBackupOrScheduleRefresh(
  streamInfo: StreamInfo,
  currentResolution: ResolutionInfo
): string | null {
  const state = getRenditionSwitchState(getRenditionScope(streamInfo, currentResolution));
  if (state.readyRefresh) {
    state.servedBackup = state.readyRefresh;
    state.readyRefresh = null;
  }

  const served = state.servedBackup;
  if (!served) return null;
  streamInfo.activeBackupPlayerType = served.playerType;
  scheduleServedBackupRefresh(streamInfo, state);
  return served.playlist;
}

function tryGetReadyBackupOrScheduleSearch(
  streamInfo: StreamInfo,
  currentResolution: ResolutionInfo,
  activePlaylist: string,
  reloadWhenReady = true
): string | null {
  const state = getRenditionSwitchState(getRenditionScope(streamInfo, currentResolution));
  const candidate = state.readyCandidate;
  if (candidate) {
    state.readyCandidate = null;
    state.servedBackup = candidate;
    state.readyRefresh = null;
    state.consecutiveRefreshFailures = 0;
    streamInfo.activeBackupPlayerType = candidate.playerType;
    scheduleServedBackupRefresh(streamInfo, state);
    logger.debug("Adblock:TwitchService", "using verified clean backup", {
      channelName: streamInfo.channelName,
      playerType: candidate.playerType,
      resolution: candidate.rendition.resolution,
    });
    return candidate.playlist;
  }

  if (state.candidatePromise || Date.now() < state.nextRetryAt) return null;

  const candidatePromise = getOrStartBackupMasterPreload(streamInfo)
    .then((masters) => prepareCleanBackup(streamInfo, currentResolution, activePlaylist, masters))
    .then((prepared) => {
      if (streamInfos.get(streamInfo.channelName) !== streamInfo) return;
      if (prepared) {
        state.readyCandidate = prepared;
        state.consecutiveMisses = 0;
        state.nextRetryAt = 0;
        // The current playlist may already be holding an unsafe stitched-ad
        // response. Ask HLS.js to reload immediately so the next playlist
        // request consumes this real clean rendition instead of waiting for
        // the normal target-duration refresh.
        if (reloadWhenReady) {
          notifyPlayerReload(streamInfo.channelName, "ad-started");
        }
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
      if (streamInfos.get(streamInfo.channelName) !== streamInfo) return;
      state.consecutiveMisses += 1;
      state.nextRetryAt =
        Date.now() +
        Math.min(
          BACKUP_MISS_RETRY_BASE_MS * 2 ** (state.consecutiveMisses - 1),
          BACKUP_MISS_RETRY_MAX_MS
        );
      logger.debug("Adblock:TwitchService", "backup candidate search deferred", {
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

  let isInsideAdRange = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      isInsideAdRange = false;
    }
    if (
      line.startsWith("#EXT-X-DATERANGE") &&
      (line.includes("stitched-ad") ||
        line.includes("twitch-stitched-ad") ||
        line.includes("com.twitch.tv/ad") ||
        line.includes("amazon-ad"))
    ) {
      isInsideAdRange = true;
    }

    // Remove tracking URLs
    line = line
      .replace(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
      .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
    lines[i] = line;

    // Mark ad segments
    const isLive = line.includes(",live");
    const isLikelyAdSegment =
      stripAllSegments || isInsideAdRange || line.includes("Amazon|") || line.includes("stitched");

    if (i < lines.length - 1 && line.startsWith("#EXTINF") && !isLive && isLikelyAdSegment) {
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
        void Promise.resolve()
          .then(() => fetch(lines[i + 1]))
          .then((response) => response?.blob?.())
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
function parseResolutionsFromPlaylist(
  text: string,
  streamInfo: StreamInfo,
  playlistBaseUrl: string
): void {
  const lines = text.replace(/\r/g, "").split("\n");

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF") && lines[i + 1].includes(".m3u8")) {
      const attrs = parseAttributes(lines[i]);
      const resolution = attrs.RESOLUTION;
      if (resolution) {
        const playlistReference = lines[i + 1].trim();
        let playlistUrl = playlistReference;
        try {
          playlistUrl = new URL(playlistReference, playlistBaseUrl).href;
        } catch {
          // Preserve the original reference when a non-standard URL cannot be resolved.
        }
        const resInfo: ResolutionInfo = {
          resolution,
          frameRate: parseFloat(attrs["FRAME-RATE"]) || 30,
          bandwidth: Number.parseInt(attrs.BANDWIDTH, 10) || 0,
          codecs: attrs.CODECS || "",
          url: playlistUrl,
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
  const status: AdBlockStatus = {
    isActive: config.enabled,
    isShowingAd: streamInfo.isShowingAd,
    isMidroll: streamInfo.isMidroll,
    isStrippingSegments: streamInfo.isStrippingAdSegments,
    numStrippedSegments: streamInfo.numStrippedAdSegments,
    activePlayerType: streamInfo.activeBackupPlayerType,
    channelName: streamInfo.channelName,
    isUsingFallbackMode: streamInfo.isUsingFallbackMode,
    adStartTime: streamInfo.adStartTime,
  };

  if (onStatusChange) {
    onStatusChange(status);
  }

  const subscribers = statusChangeSubscribers.get(streamInfo.channelName.trim().toLowerCase());
  if (subscribers) {
    for (const subscriber of subscribers) {
      subscriber(status);
    }
  }
}

// Callbacks for player control (to be set by HLS player)
export type PlayerReloadReason = "ad-started" | "ad-ended";

type PlayerReloadCallback = (reason: PlayerReloadReason) => void;

const playerReloadCallbacks = new Map<string, PlayerReloadCallback>();
const channelsWithAdStartReload = new Set<string>();
const playerReloadGuardResetTimers = new Map<string, ReturnType<typeof setTimeout>>();
let legacyPlayerReloadCallback: PlayerReloadCallback | null = null;

export function setPlayerCallbacks(
  channelName: string,
  reloadCallback: PlayerReloadCallback
): () => void;
export function setPlayerCallbacks(reloadCallback: PlayerReloadCallback): () => void;
export function setPlayerCallbacks(
  channelNameOrReloadCallback: string | PlayerReloadCallback,
  reloadCallback?: PlayerReloadCallback
): () => void {
  if (typeof channelNameOrReloadCallback === "string") {
    const channelKey = channelNameOrReloadCallback.toLowerCase();
    if (!reloadCallback) return () => {};
    cancelPlayerReloadGuardReset(channelKey);
    playerReloadCallbacks.set(channelKey, reloadCallback);
    return () => {
      if (playerReloadCallbacks.get(channelKey) === reloadCallback) {
        playerReloadCallbacks.delete(channelKey);
        schedulePlayerReloadGuardReset(channelKey);
      }
    };
  }

  legacyPlayerReloadCallback = channelNameOrReloadCallback;
  return () => {
    if (legacyPlayerReloadCallback === channelNameOrReloadCallback) {
      legacyPlayerReloadCallback = null;
    }
  };
}

function notifyPlayerReload(channelName: string, reason: PlayerReloadReason): void {
  const channelKey = channelName.toLowerCase();
  const callback = playerReloadCallbacks.get(channelKey) ?? legacyPlayerReloadCallback;

  if (reason === "ad-started") {
    if (!callback || channelsWithAdStartReload.has(channelKey)) return;
    channelsWithAdStartReload.add(channelKey);
  } else {
    resetPlayerReloadGuard(channelKey);
  }

  callback?.(reason);
}

function resetPlayerReloadGuard(channelName: string): void {
  const channelKey = channelName.toLowerCase();
  cancelPlayerReloadGuardReset(channelKey);
  channelsWithAdStartReload.delete(channelKey);
}

function schedulePlayerReloadGuardReset(channelName: string): void {
  cancelPlayerReloadGuardReset(channelName);
  // timer-allowlist: releases an imperative per-channel recovery guard outside React lifecycle.
  const timer = setTimeout(() => {
    playerReloadGuardResetTimers.delete(channelName);
    if (!playerReloadCallbacks.has(channelName)) {
      channelsWithAdStartReload.delete(channelName);
    }
  }, PLAYER_RELOAD_GUARD_RELEASE_MS);
  playerReloadGuardResetTimers.set(channelName, timer);
}

function cancelPlayerReloadGuardReset(channelName: string): void {
  const timer = playerReloadGuardResetTimers.get(channelName);
  if (timer) clearTimeout(timer);
  playerReloadGuardResetTimers.delete(channelName);
}
