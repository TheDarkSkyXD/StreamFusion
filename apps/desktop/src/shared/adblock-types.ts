/**
 * Twitch Ad-Block Types
 *
 * Type definitions for the VAFT-inspired ad-blocking system.
 * Based on https://github.com/pixeltris/TwitchAdSolutions
 */

/**
 * Resolution information for a stream quality level
 */
export interface ResolutionInfo {
  resolution: string; // e.g., "1920x1080"
  frameRate: number;
  bandwidth: number;
  codecs: string; // e.g., "avc1.4D401F,mp4a.40.2" or "hev1.1.6.L120"
  url: string; // m3u8 URL for this quality
}

/**
 * Stream state tracking for ad-blocking
 */
export interface StreamInfo {
  channelName: string;
  isShowingAd: boolean;
  isMidroll: boolean;
  lastPlayerReload: number;

  // Original stream data
  encodingsM3U8: string | null;
  modifiedM3U8: string | null;
  isUsingModifiedM3U8: boolean;
  usherParams: string;

  // Resolution mapping
  urls: Map<string, ResolutionInfo>;
  resolutionList: ResolutionInfo[];

  // Backup stream management
  backupEncodingsCache: Map<string, string>;
  activeBackupPlayerType: string | null;

  // Ad segment tracking
  requestedAds: Set<string>;
  isStrippingAdSegments: boolean;
  numStrippedAdSegments: number;

  // Fallback mode tracking
  isUsingFallbackMode: boolean;
  adStartTime: number | null;

  /** Last known stream bitrate for drop detection */
  lastKnownBitrate: number | null;
}

/**
 * Ad-block configuration options
 */
export interface AdBlockConfig {
  /** Whether ad-blocking is enabled */
  enabled: boolean;

  /** Ad signifier string in m3u8 playlists */
  adSignifier: string;

  /** Twitch GQL Client ID */
  clientId: string;

  /** Player types to try for ad-free streams (in order) */
  backupPlayerTypes: PlayerType[];

  /** Default fallback player type */
  fallbackPlayerType: PlayerType;

  /** Player type to force for access token requests */
  forceAccessTokenPlayerType: PlayerType;

  /** Whether to skip player reload on HEVC streams */
  skipPlayerReloadOnHevc: boolean;

  /** Always reload player when entering/leaving ads */
  alwaysReloadPlayerOnAd: boolean;

  /** Reload player after ad finishes (instead of pause/play) */
  reloadPlayerAfterAd: boolean;

  /** Time window for minimal requests after player reload */
  playerReloadMinimalRequestsTime: number;

  /** Player index to use during minimal requests time */
  playerReloadMinimalRequestsPlayerIndex: number;

  /** Whether ad segment stripping is enabled */
  isAdStrippingEnabled: boolean;

  /** Player buffering fix settings */
  playerBufferingFix: boolean;
  playerBufferingDelay: number;
  playerBufferingSameStateCount: number;
  playerBufferingDangerZone: number;
  playerBufferingDoPlayerReload: boolean;
  playerBufferingMinRepeatDelay: number;

  /** Use DATERANGE tags for primary ad detection */
  useDateRangeDetection: boolean;

  /** Use bitrate drop as secondary detection */
  useBitrateDropDetection: boolean;

  /** Minimum bitrate drop percentage to trigger detection (0-1) */
  bitrateDropThreshold: number;

  /** Enable 160p segment replacement (vs blank video) */
  use160pReplacement: boolean;
}

/**
 * Player types that can be used to request access tokens
 */
export type PlayerType =
  "site" | "embed" | "popout" | "autoplay" | "picture-by-picture" | "thunderdome";

/**
 * Ad-block status for UI display
 */
export interface AdBlockStatus {
  isActive: boolean;
  isShowingAd: boolean;
  isMidroll: boolean;
  isStrippingSegments: boolean;
  numStrippedSegments: number;
  activePlayerType: string | null;
  channelName: string | null;
  /** True when all backup player types failed and using fallback overlay */
  isUsingFallbackMode: boolean;
  /** Timestamp when ad started (for elapsed time display) */
  adStartTime: number | null;
}

/**
 * GQL access token response
 */
export interface AccessTokenResponse {
  data: {
    streamPlaybackAccessToken: {
      value: string;
      signature: string;
    } | null;
  };
}

// ========== Auto-Updating Pattern Types ==========

/**
 * Ad pattern update fetched from VAFT repository
 */
export interface AdPatternUpdate {
  /** VAFT script version number */
  version: number;
  /** Primary ad signifier strings (e.g., 'stitched') */
  adSignifiers: string[];
  /** DATERANGE tag patterns that indicate ads */
  dateRangePatterns: string[];
  /** Player types to try for backup streams */
  backupPlayerTypes: PlayerType[];
  /** Fallback player type */
  fallbackPlayerType: PlayerType;
  /** GQL Client ID */
  clientId: string;
  /** Last time patterns were updated (ISO string) */
  lastUpdated: string;
  /** Source URL where patterns were fetched from */
  source: string;
}

/**
 * Stored ad patterns with metadata
 */
export interface StoredAdPatterns {
  /** The pattern data */
  patterns: AdPatternUpdate;
  /** When the patterns were last checked */
  lastChecked: string;
  /** Whether auto-update is enabled */
  autoUpdateEnabled: boolean;
}

/**
 * Default DATERANGE patterns for ad detection
 * These are the known patterns Twitch uses to mark ad segments
 */
export const DEFAULT_DATERANGE_PATTERNS: readonly string[] = [
  "stitched-ad",
  "com.twitch.tv/ad",
  "amazon-ad",
  "twitch-stitched-ad",
  "amazon-video-ad",
  "twitch-ad-break",
  "X-STITCHED",
  "ad-insertion",
  "twitch-ad-quartile",
  "amazon-adsystem",
] as const;

/**
 * Default ad signifiers
 */
export const DEFAULT_AD_SIGNIFIERS: readonly string[] = ["stitched"] as const;

/**
 * Default stored ad patterns
 */
export const DEFAULT_STORED_PATTERNS: StoredAdPatterns = {
  patterns: {
    version: 0,
    adSignifiers: [...DEFAULT_AD_SIGNIFIERS],
    dateRangePatterns: [...DEFAULT_DATERANGE_PATTERNS],
    backupPlayerTypes: ["embed", "popout", "autoplay", "picture-by-picture", "thunderdome"],
    fallbackPlayerType: "embed",
    clientId: "kimne78kx3ncx6brgo4mv6wki5h1ko",
    lastUpdated: new Date().toISOString(),
    source: "default",
  },
  lastChecked: new Date().toISOString(),
  autoUpdateEnabled: true,
};

/**
 * Default ad-block configuration
 */
export const DEFAULT_ADBLOCK_CONFIG: AdBlockConfig = {
  enabled: true,
  adSignifier: "stitched",
  clientId: "kimne78kx3ncx6brgo4mv6wki5h1ko",
  backupPlayerTypes: ["embed", "popout", "autoplay", "picture-by-picture", "thunderdome"],
  fallbackPlayerType: "embed",
  forceAccessTokenPlayerType: "popout",
  skipPlayerReloadOnHevc: true,
  alwaysReloadPlayerOnAd: false,
  reloadPlayerAfterAd: false,
  playerReloadMinimalRequestsTime: 1500,
  playerReloadMinimalRequestsPlayerIndex: 2,
  isAdStrippingEnabled: true,
  playerBufferingFix: true,
  playerBufferingDelay: 500,
  playerBufferingSameStateCount: 3,
  playerBufferingDangerZone: 1,
  playerBufferingDoPlayerReload: false,
  playerBufferingMinRepeatDelay: 5000,
  useDateRangeDetection: true,
  useBitrateDropDetection: true,
  bitrateDropThreshold: 0.7,
  use160pReplacement: true,
};

/**
 * Create a new StreamInfo object for a channel
 */
export function createStreamInfo(channelName: string, usherParams: string): StreamInfo {
  return {
    channelName,
    isShowingAd: false,
    isMidroll: false,
    lastPlayerReload: 0,
    encodingsM3U8: null,
    modifiedM3U8: null,
    isUsingModifiedM3U8: false,
    usherParams,
    urls: new Map(),
    resolutionList: [],
    backupEncodingsCache: new Map(),
    activeBackupPlayerType: null,
    requestedAds: new Set(),
    isStrippingAdSegments: false,
    numStrippedAdSegments: 0,
    isUsingFallbackMode: false,
    adStartTime: null,
    lastKnownBitrate: null,
  };
}
