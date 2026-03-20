/**
 * IPC Channel Definitions
 *
 * Type-safe IPC channel names shared between main and renderer processes.
 * All IPC communication should use these constants.
 */

import type {
  AuthToken,
  KickUser,
  LocalFollow,
  Platform,
  TwitchUser,
  UserPreferences,
} from "./auth-types";

export const IPC_CHANNELS = {
  // App lifecycle
  APP_GET_VERSION: "app:get-version",
  APP_GET_VERSION_INFO: "app:get-version-info",
  APP_GET_NAME: "app:get-name",
  APP_QUIT: "app:quit",
  APP_RELAUNCH: "app:relaunch",

  // Window management
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_ON_MAXIMIZE_CHANGE: "window:on-maximize-change",

  // Theme
  THEME_GET: "theme:get",
  THEME_SET: "theme:set",
  THEME_GET_SYSTEM: "theme:get-system",

  // Generic Storage (deprecated in favor of specific handlers)
  STORE_GET: "store:get",
  STORE_SET: "store:set",
  STORE_DELETE: "store:delete",

  // Auth - OAuth Flow
  AUTH_OPEN_TWITCH: "auth:open-twitch",
  AUTH_OPEN_KICK: "auth:open-kick",
  AUTH_ON_CALLBACK: "auth:on-callback",

  // Auth - Token Management
  AUTH_GET_TOKEN: "auth:get-token",
  AUTH_SAVE_TOKEN: "auth:save-token",
  AUTH_CLEAR_TOKEN: "auth:clear-token",
  AUTH_HAS_TOKEN: "auth:has-token",
  AUTH_IS_TOKEN_EXPIRED: "auth:is-token-expired",
  AUTH_CLEAR_ALL_TOKENS: "auth:clear-all-tokens",

  // Auth - User Data
  AUTH_GET_TWITCH_USER: "auth:get-twitch-user",
  AUTH_SAVE_TWITCH_USER: "auth:save-twitch-user",
  AUTH_CLEAR_TWITCH_USER: "auth:clear-twitch-user",
  AUTH_GET_KICK_USER: "auth:get-kick-user",
  AUTH_SAVE_KICK_USER: "auth:save-kick-user",
  AUTH_CLEAR_KICK_USER: "auth:clear-kick-user",

  // Auth - Logout and Refresh
  AUTH_LOGOUT: "auth:logout",
  AUTH_LOGOUT_TWITCH: "auth:logout-twitch",
  AUTH_LOGOUT_KICK: "auth:logout-kick",
  AUTH_REFRESH_TWITCH: "auth:refresh-twitch",
  AUTH_REFRESH_KICK: "auth:refresh-kick",
  AUTH_FETCH_TWITCH_USER: "auth:fetch-twitch-user",
  AUTH_FETCH_KICK_USER: "auth:fetch-kick-user",

  // Auth - Device Code Flow (Twitch)
  AUTH_DCF_START: "auth:dcf-start",
  AUTH_DCF_POLL: "auth:dcf-poll",
  AUTH_DCF_CANCEL: "auth:dcf-cancel",
  AUTH_DCF_STATUS: "auth:dcf-status",

  // Auth - Status
  AUTH_GET_STATUS: "auth:get-status",

  // Auth - Session Events (main → renderer push)
  AUTH_KICK_SESSION_EXPIRED: "auth:kick-session-expired",

  // Local Follows
  FOLLOWS_GET_ALL: "follows:get-all",
  FOLLOWS_GET_BY_PLATFORM: "follows:get-by-platform",
  FOLLOWS_ADD: "follows:add",
  FOLLOWS_REMOVE: "follows:remove",
  FOLLOWS_UPDATE: "follows:update",
  FOLLOWS_IS_FOLLOWING: "follows:is-following",
  FOLLOWS_IMPORT: "follows:import",
  FOLLOWS_CLEAR: "follows:clear",

  // User Preferences
  PREFERENCES_GET: "preferences:get",
  PREFERENCES_UPDATE: "preferences:update",
  PREFERENCES_RESET: "preferences:reset",

  // External links
  SHELL_OPEN_EXTERNAL: "shell:open-external",

  // Notifications
  NOTIFICATION_SHOW: "notification:show",

  // Image Proxy (bypass CORS for external images)
  IMAGE_PROXY: "image:proxy",

  // ========== Discovery: Streams ==========
  STREAMS_GET_TOP: "streams:get-top",
  STREAMS_GET_BY_CATEGORY: "streams:get-by-category",
  STREAMS_GET_FOLLOWED: "streams:get-followed",
  STREAMS_GET_BY_CHANNEL: "streams:get-by-channel",
  STREAMS_GET_PLAYBACK_URL: "streams:get-playback-url",

  // ========== Discovery: Categories ==========
  CATEGORIES_GET_TOP: "categories:get-top",
  CATEGORIES_GET_BY_ID: "categories:get-by-id",
  CATEGORIES_SEARCH: "categories:search",

  // ========== Discovery: Search ==========
  SEARCH_CHANNELS: "search:channels",
  SEARCH_ALL: "search:all",

  // ========== Discovery: Channels ==========
  CHANNELS_GET_BY_ID: "channels:get-by-id",
  CHANNELS_GET_BY_USERNAME: "channels:get-by-username",
  CHANNELS_GET_FOLLOWED: "channels:get-followed",

  // ========== Discovery: Videos ==========
  VIDEOS_GET_METADATA: "videos:get-metadata",
  VIDEOS_GET_PLAYBACK_URL: "videos:get-playback-url",
  VIDEOS_GET_BY_CHANNEL: "videos:get-by-channel",

  // ========== Discovery: Clips ==========
  CLIPS_GET_BY_CHANNEL: "clips:get-by-channel",
  CLIPS_GET_PLAYBACK_URL: "clips:get-playback-url",

  // ========== VOD Lookup (for clip-to-VOD navigation) ==========
  VIDEOS_GET_BY_LIVESTREAM_ID: "videos:get-by-livestream-id",

  // ========== Network Ad Blocking ==========
  ADBLOCK_GET_STATUS: "adblock:get-status",
  ADBLOCK_TOGGLE: "adblock:toggle",
  ADBLOCK_GET_STATS: "adblock:get-stats",
  ADBLOCK_PROXY_STATUS: "adblock:proxy-status",

  // ========== Cosmetic Injection ==========
  ADBLOCK_INJECT_COSMETICS: "adblock:inject-cosmetics",

  // ========== Stream Proxy Cleanup ==========
  ADBLOCK_PROXY_CLEAR_STREAM: "adblock:proxy-clear-stream",
  ADBLOCK_PROXY_CLEAR_ALL: "adblock:proxy-clear-all",

  // ========== VAFT Pattern Auto-Update ==========
  ADBLOCK_PATTERNS_GET: "adblock:patterns-get",
  ADBLOCK_PATTERNS_REFRESH: "adblock:patterns-refresh",
  ADBLOCK_PATTERNS_GET_STATS: "adblock:patterns-get-stats",
  ADBLOCK_PATTERNS_SET_AUTO_UPDATE: "adblock:patterns-set-auto-update",

  // ========== App Auto-Update ==========
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL: "update:install",
  UPDATE_GET_STATUS: "update:get-status",
  UPDATE_SET_ALLOW_PRERELEASE: "update:set-allow-prerelease",
  UPDATE_GET_SETTINGS: "update:get-settings",
  UPDATE_ON_STATUS_CHANGE: "update:on-status-change",
  UPDATE_ON_PROGRESS: "update:on-progress",
} as const;

// Type for channel names
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ========== Payload Types for IPC Calls ==========

export interface IpcPayloads {
  // Generic storage
  [IPC_CHANNELS.STORE_GET]: { key: string };
  [IPC_CHANNELS.STORE_SET]: { key: string; value: unknown };
  [IPC_CHANNELS.STORE_DELETE]: { key: string };

  // Theme
  [IPC_CHANNELS.THEME_SET]: { theme: "light" | "dark" | "system" };

  // Auth tokens
  [IPC_CHANNELS.AUTH_GET_TOKEN]: { platform: Platform };
  [IPC_CHANNELS.AUTH_SAVE_TOKEN]: { platform: Platform; token: AuthToken };
  [IPC_CHANNELS.AUTH_CLEAR_TOKEN]: { platform: Platform };
  [IPC_CHANNELS.AUTH_HAS_TOKEN]: { platform: Platform };
  [IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED]: { platform: Platform };

  // User data
  [IPC_CHANNELS.AUTH_SAVE_TWITCH_USER]: { user: TwitchUser };
  [IPC_CHANNELS.AUTH_SAVE_KICK_USER]: { user: KickUser };

  // Local follows
  [IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM]: { platform: Platform };
  [IPC_CHANNELS.FOLLOWS_ADD]: { follow: Omit<LocalFollow, "id" | "followedAt"> };
  [IPC_CHANNELS.FOLLOWS_REMOVE]: { id: string };
  [IPC_CHANNELS.FOLLOWS_UPDATE]: { id: string; updates: Partial<LocalFollow> };
  [IPC_CHANNELS.FOLLOWS_IS_FOLLOWING]: { platform: Platform; channelId: string };
  [IPC_CHANNELS.FOLLOWS_IMPORT]: { follows: LocalFollow[] };

  // Preferences
  [IPC_CHANNELS.PREFERENCES_UPDATE]: { updates: Partial<UserPreferences> };

  // External links
  [IPC_CHANNELS.SHELL_OPEN_EXTERNAL]: { url: string };

  // Notifications
  [IPC_CHANNELS.NOTIFICATION_SHOW]: { title: string; body: string };
}

// ========== Response Types for IPC Calls ==========

export interface AuthStatus {
  twitch: {
    connected: boolean;
    user: TwitchUser | null;
    hasToken: boolean;
    isExpired: boolean;
  };
  kick: {
    connected: boolean;
    user: KickUser | null;
    hasToken: boolean;
    isExpired: boolean;
  };
  isGuest: boolean;
}

// ========== Version Info Types ==========

export type ReleaseChannel = "stable" | "beta" | "alpha" | "rc";

export interface VersionInfo {
  /** Full version string (e.g., "1.0.1") */
  version: string;
  /** Whether this is a pre-release version */
  isPrerelease: boolean;
  /** Release channel: stable, beta, alpha, or rc */
  channel: ReleaseChannel;
  /** Display string for UI (e.g., "1.0.1 (Pre-release)") */
  displayVersion: string;
}

// ========== App Auto-Update Types ==========

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string | null;
  releaseName: string | null;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  allowPrerelease: boolean;
}

export interface UpdateSettings {
  allowPrerelease: boolean;
}
