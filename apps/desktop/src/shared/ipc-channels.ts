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
  ProxyPreferences,
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
  /**
   * Main → renderer push fired at the start of `app.before-quit`. The
   * renderer responds with an aggressive teardown (drop chat sockets, stop
   * batching) so the close path doesn't wait on graceful WebSocket teardowns
   * or chat-store cleanup. Main hard-kills 3s later either way.
   */
  APP_BEFORE_QUIT: "app:before-quit",

  // Window management
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_ON_MAXIMIZE_CHANGE: "window:on-maximize-change",
  WINDOW_TOGGLE_DEV_TOOLS: "window:toggle-dev-tools",

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
  AUTH_GET_VALID_TWITCH_TOKEN: "auth:get-valid-twitch-token",
  AUTH_TWITCH_AUTH_LOST: "auth:twitch-auth-lost",
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
  /**
   * Read-only token-status probe (Xtra port U14). Per platform, returns
   * connected/valid + login/userId/scopes/expiry ONLY — never a token value.
   * Validates live (Twitch /validate; Kick current-user re-fetch). Handler
   * checks `event.senderFrame.url` like the other privileged channels.
   */
  AUTH_TOKEN_STATUS: "auth:token-status",

  // Auth - Session Events (main → renderer push)
  AUTH_KICK_SESSION_EXPIRED: "auth:kick-session-expired",
  // Fired by syncFollowsOnLogin after a successful login + bulk import of
  // account-source follows into the local DB. Renderer subscribers re-hydrate
  // useFollowStore and invalidate the followed-channels / followed-streams
  // React-Query caches so the sidebar, FollowButton state, and Following page
  // catch up without a manual refresh.
  AUTH_FOLLOWS_SYNCED: "auth:follows-synced",

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

  // ========== Outbound Stream Proxy (main-process, Xtra port U11) ==========
  // Apply/clear the proxy on the window's session from a host/port/enabled
  // config. Credentials are NOT passed here — they go via PROXY_SET_CREDENTIALS
  // and stay encrypted in main. Both handlers validate `event.senderFrame.url`.
  PROXY_APPLY: "proxy:apply",
  PROXY_SET_CREDENTIALS: "proxy:set-credentials",
  PROXY_HAS_CREDENTIALS: "proxy:has-credentials",

  // External links
  SHELL_OPEN_EXTERNAL: "shell:open-external",

  // Notifications
  NOTIFICATION_SHOW: "notification:show",

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
  CATEGORIES_GET_METADATA: "categories:get-metadata",

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

  // ========== Chat ==========
  CHAT_GET_KICK_HISTORY: "chat:get-kick-history",
  CHAT_GET_TWITCH_HISTORY: "chat:get-twitch-history",
  // Kick send-window IPC bridge. The send-window owns electron BrowserWindow +
  // a webRequest interceptor + the kick.com session bearer — all main-only.
  // Renderer goes through these channels so kick-chat.ts stays renderer-safe
  // (no transitive better-sqlite3 / electron import via channel-endpoints).
  KICK_CHAT_ENSURE_SEND_WINDOW_READY: "kick-chat:ensure-send-window-ready",
  KICK_CHAT_SEND_MESSAGE: "kick-chat:send-message",
  KICK_CHAT_DISPOSE_SEND_WINDOW: "kick-chat:dispose-send-window",

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

  // ========== Mod Log ==========
  MODLOG_INSERT: "modlog:insert",
  MODLOG_QUERY: "modlog:query",
  MODLOG_SWEEP_RETENTION: "modlog:sweep-retention",

  // ========== Retention Settings ==========
  RETENTION_GET: "retention:get",
  RETENTION_SET: "retention:set",

  // ========== App Auto-Update ==========
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL: "update:install",
  UPDATE_GET_STATUS: "update:get-status",
  UPDATE_SET_ALLOW_PRERELEASE: "update:set-allow-prerelease",
  UPDATE_SET_AUTO_CHECK: "update:set-auto-check",
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
  [IPC_CHANNELS.AUTH_TOKEN_STATUS]: { platform: Platform };
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

  // Stream proxy — config carries host/port/enabled only (no credentials).
  [IPC_CHANNELS.PROXY_APPLY]: { config: ProxyApplyConfig };
  // Credentials are write-only: a null clears the stored pair; a value stores
  // it encrypted. The password is never returned by any channel.
  [IPC_CHANNELS.PROXY_SET_CREDENTIALS]: { credentials: ProxyCredentialsInput | null };

  // External links
  [IPC_CHANNELS.SHELL_OPEN_EXTERNAL]: { url: string };

  // Notifications
  [IPC_CHANNELS.NOTIFICATION_SHOW]: { title: string; body: string };

  // App auto-update — auto-check toggle + frequency (U15). Either field is
  // optional so the renderer can update one without resending the other.
  [IPC_CHANNELS.UPDATE_SET_AUTO_CHECK]: { enabled?: boolean; frequency?: CheckFrequency };

  // Kick chat send — chatroomId addresses the v2 broadcast endpoint; content
  // is the raw message text. ensure-ready and dispose take no payload.
  [IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE]: { chatroomId: number; content: string };
}

// ========== Stream Proxy Types (Xtra port U11) ==========

/**
 * The proxy config the renderer passes to `PROXY_APPLY`. Mirrors the
 * persistable `ProxyPreferences` MINUS `hasCredentials` (main-owned advisory
 * flag). No credential fields — those flow only through `PROXY_SET_CREDENTIALS`
 * and never leave main thereafter.
 */
export type ProxyApplyConfig = Pick<ProxyPreferences, "enabled" | "host" | "port">;

/**
 * Write-only credentials input for `PROXY_SET_CREDENTIALS`. The password is
 * encrypted via safeStorage in main and is NEVER returned to the renderer by
 * any channel (no read counterpart exists).
 */
export interface ProxyCredentialsInput {
  username: string;
  password: string;
}

/**
 * Result of `PROXY_APPLY`. Reports what main actually did so U12's UI can show
 * an accurate status (disabled / applied / error) — but never the credentials.
 */
export interface ProxyApplyResult {
  /** True when a proxy is now active on the session. */
  applied: boolean;
  /** True when the config was a safe no-op (disabled or empty host). */
  cleared: boolean;
  /** Whether encrypted credentials are stored (advisory; never the values). */
  hasCredentials: boolean;
  /** Present only on failure; a sanitized message safe to surface in the UI. */
  error?: string;
}

// ========== Token Status Types (Xtra port U14) ==========

/**
 * Strict read-only result of `AUTH_TOKEN_STATUS`. Reports the signed-in
 * identity, validity, expiry, and granted scopes for a platform — and NOTHING
 * that could leak a credential. There is deliberately NO `accessToken` /
 * `token` / `refreshToken` / `access_token` key; token values never leave main
 * (R28). The API/Tokens panel (U14) renders four states from this:
 *   - `connected:false`                → not signed in
 *   - `connected:true, valid:false`    → token invalid or expired (reconnect)
 *   - `connected:true, valid:true`     → show login/userId/expiry/scopes
 *
 * Notes on the two platforms:
 *   - Twitch fields come from `id.twitch.tv/oauth2/validate` (which takes only
 *     the OAuth bearer header — no Client-Id).
 *   - Kick has no `/validate`; validity is a current-user re-fetch and `userId`
 *     is the Kick OAuth `user_id`. Kick reports no expiry, so `expiresAt` falls
 *     back to the STORED token's `expiresAt` (null when none).
 */
export interface TokenStatusResult {
  platform: Platform;
  /** Whether a stored token exists at all. */
  connected: boolean;
  /** Whether the stored token validated live just now. */
  valid: boolean;
  /** Account login / username (Twitch login, Kick name). Absent when invalid. */
  login?: string;
  /** Platform user id (Twitch user_id; Kick OAuth user_id). Absent when invalid. */
  userId?: string;
  /** Granted OAuth scopes. A 200 does NOT imply sufficient scopes — shown honestly. */
  scopes?: string[];
  /** Expiry as a Unix ms timestamp; `null` when unknown (no stored expiry). */
  expiresAt?: number | null;
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

/**
 * How often the auto-check scheduler may fire. A discrete preset (never a
 * free-form number) so a tampered value can't drive a sub-minimum interval; the
 * scheduler still clamps the derived interval to a 1-hour floor regardless.
 */
export type CheckFrequency = "hourly" | "daily" | "weekly";

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
  /** Whether the interval auto-check scheduler is active (U15). */
  autoCheckEnabled: boolean;
  /** How often the scheduler may fire when enabled (U15). */
  checkFrequency: CheckFrequency;
}

export interface UpdateSettings {
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: CheckFrequency;
}
