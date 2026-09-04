/**
 * IPC Channel Definitions
 *
 * Type-safe IPC channel names shared between main and renderer processes.
 * All IPC communication should use these constants.
 */

import type {
  AuthToken,
  KickAccountFollowWriteRequest,
  KickUser,
  LocalFollow,
  ProxyPreferences,
  TwitchUser,
  UserPreferences,
} from "./auth-types";
import { Platform } from "@streamfusion/core/platform";
import type { SubscriberEligibilityRequest } from "./chat-types";
import type {
  CancelChatReplayWindowRequest,
  ChatReplayIpcWindowRequest,
} from "./chat-replay-types";
import type { CategoryClipsRequest, CategoryVideosRequest } from "./category-media-types";
import type { ClipDownloadRequest, VideoDownloadRequest } from "./download-types";
import type { LocalCaptionPcmChunk, LocalCaptionSessionIdentity } from "./local-caption-types";
import type { SlotQualityMode } from "./slot-types";
import type { StreamRecordingRequest } from "./stream-recording-types";
import type { TimeoutActionBinding, TimeoutSubmitInput } from "./timeout-moderation-types";
import type { TwitchApiCommand } from "./twitch-api-types";

export const IPC_CHANNELS = {
  // App lifecycle
  APP_GET_VERSION: "app:get-version",
  APP_GET_VERSION_INFO: "app:get-version-info",
  APP_GET_NAME: "app:get-name",
  APP_GET_ENVIRONMENT: "app:get-environment",
  APP_QUIT: "app:quit",
  APP_RELAUNCH: "app:relaunch",
  IPC_FEATURE_LOAD: "ipc:feature-load",
  CONNECTIVITY_CHECK: "connectivity:check",
  /**
   * Main → renderer push fired at the start of `app.before-quit`. The
   * renderer responds with an aggressive teardown (drop chat sockets, stop
   * batching), then requests the normal window-close route. Main retains a
   * three-second force-close only as a fallback for an unresponsive renderer.
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
  AUTH_SYNC_FOLLOWS: "auth:sync-follows",

  // Auth - Device Code Flow (Twitch)
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

  // Main-owned Twitch Helix capability boundary.
  TWITCH_API_EXECUTE: "twitch-api:execute",
  TWITCH_EVENTSUB_START: "twitch-eventsub:start",
  TWITCH_EVENTSUB_STOP: "twitch-eventsub:stop",
  TWITCH_EVENTSUB_EVENT: "twitch-eventsub:event",
  TWITCH_EVENTSUB_STATE: "twitch-eventsub:state",

  // Public user profile reads (main-process Platform boundary)
  USER_PROFILE_TWITCH_IDENTITY: "user-profile:twitch-identity",
  USER_PROFILE_TWITCH_ACCOUNT_CREATED: "user-profile:twitch-account-created",
  USER_PROFILE_TWITCH_FOLLOW: "user-profile:twitch-follow",
  USER_PROFILE_TWITCH_CHANNEL: "user-profile:twitch-channel",
  USER_PROFILE_KICK_IDENTITY: "user-profile:kick-identity",
  USER_PROFILE_KICK_ACCOUNT_CREATED: "user-profile:kick-account-created",
  USER_PROFILE_KICK_FOLLOW: "user-profile:kick-follow",
  USER_PROFILE_KICK_CHANNEL: "user-profile:kick-channel",

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
  FOLLOWS_GET_ACCOUNT_WRITES: "follows:get-account-writes",
  FOLLOWS_WRITE_ACCOUNT: "follows:write-account",
  FOLLOWS_ACCOUNT_WRITE_CHANGED: "follows:account-write-changed",

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
  NOTIFICATION_LIVE_RECEIVED: "notification:live-received",
  NOTIFICATION_OPEN_STREAM: "notification:open-stream",
  NOTIFICATION_COVERAGE_GET: "notification:coverage-get",

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
  SEARCH_CANCEL: "search:cancel",
  SEARCH_STREAMS: "search:streams",
  SEARCH_VIDEOS: "search:videos",
  SEARCH_CLIPS: "search:clips",

  // ========== Discovery: Channels ==========
  CHANNELS_GET_BY_ID: "channels:get-by-id",
  CHANNELS_GET_BY_USERNAME: "channels:get-by-username",
  CHANNELS_GET_FOLLOWED: "channels:get-followed",

  // ========== Discovery: Videos ==========
  VIDEOS_GET_METADATA: "videos:get-metadata",
  VIDEOS_GET_PLAYBACK_URL: "videos:get-playback-url",
  VIDEOS_GET_BY_CHANNEL: "videos:get-by-channel",
  VIDEOS_GET_BY_CATEGORY: "videos:get-by-category",
  VIDEOS_GET_CHAT_REPLAY_WINDOW: "videos:get-chat-replay-window",
  VIDEOS_CANCEL_CHAT_REPLAY_WINDOW: "videos:cancel-chat-replay-window",

  // ========== Discovery: Clips ==========
  CLIPS_GET_BY_CHANNEL: "clips:get-by-channel",
  CLIPS_GET_BY_CATEGORY: "clips:get-by-category",
  CLIPS_GET_PLAYBACK_URL: "clips:get-playback-url",

  // ========== Downloads ==========
  DOWNLOADS_GET_QUEUE: "downloads:get-queue",
  DOWNLOADS_DOWNLOAD_CLIP: "downloads:download-clip",
  DOWNLOADS_DOWNLOAD_VIDEO: "downloads:download-video",
  DOWNLOADS_PAUSE: "downloads:pause",
  DOWNLOADS_RESUME: "downloads:resume",
  DOWNLOADS_CANCEL: "downloads:cancel",
  DOWNLOADS_RETRY: "downloads:retry",
  DOWNLOADS_REMOVE: "downloads:remove",
  DOWNLOADS_SHOW_IN_FOLDER: "downloads:show-in-folder",
  DOWNLOADS_OPEN_FILE: "downloads:open-file",
  DOWNLOADS_DELETE_FILE: "downloads:delete-file",
  DOWNLOADS_QUEUE_CHANGED: "downloads:queue-changed",

  // ========== Stream Recording ==========
  STREAM_RECORDING_GET_STATE: "stream-recording:get-state",
  STREAM_RECORDING_START: "stream-recording:start",
  STREAM_RECORDING_STOP: "stream-recording:stop",
  STREAM_RECORDING_DISCARD: "stream-recording:discard",
  STREAM_RECORDING_PAUSE: "stream-recording:pause",
  STREAM_RECORDING_RESUME: "stream-recording:resume",
  STREAM_RECORDING_RESUME_INTERRUPTED: "stream-recording:resume-interrupted",
  STREAM_RECORDING_FINALIZE_INTERRUPTED: "stream-recording:finalize-interrupted",
  STREAM_RECORDING_DISMISS_INTERRUPTED: "stream-recording:dismiss-interrupted",
  STREAM_RECORDING_OPEN_COMPLETED: "stream-recording:open-completed",
  STREAM_RECORDING_SHOW_COMPLETED: "stream-recording:show-completed",
  STREAM_RECORDING_DISMISS_NOTICE: "stream-recording:dismiss-notice",
  STREAM_RECORDING_STATE_CHANGED: "stream-recording:state-changed",

  // ========== Local Captions ==========
  LOCAL_CAPTIONS_MODEL_GET_STATE: "local-captions:model-get-state",
  LOCAL_CAPTIONS_MODEL_DOWNLOAD: "local-captions:model-download",
  LOCAL_CAPTIONS_MODEL_CANCEL: "local-captions:model-cancel",
  LOCAL_CAPTIONS_MODEL_REMOVE: "local-captions:model-remove",
  LOCAL_CAPTIONS_MODEL_STATE: "local-captions:model-state",
  LOCAL_CAPTIONS_SESSION_START: "local-captions:session-start",
  LOCAL_CAPTIONS_AUDIO_PUSH: "local-captions:audio-push",
  LOCAL_CAPTIONS_SESSION_STOP: "local-captions:session-stop",
  LOCAL_CAPTIONS_RESULT: "local-captions:result",
  LOCAL_CAPTIONS_RECOGNIZER_STATE: "local-captions:recognizer-state",

  // ========== VOD Lookup (for clip-to-VOD navigation) ==========
  VIDEOS_GET_BY_LIVESTREAM_ID: "videos:get-by-livestream-id",

  // ========== Chat ==========
  CHAT_GET_KICK_HISTORY: "chat:get-kick-history",
  CHAT_GET_TWITCH_HISTORY: "chat:get-twitch-history",
  CHAT_GET_TWITCH_BADGE_CATALOG: "chat:get-twitch-badge-catalog",
  CHAT_GET_TWITCH_PINNED_MESSAGE: "chat:get-twitch-pinned-message",
  CHAT_ENRICH_MENTION_USERS: "chat:enrich-mention-users",
  CHAT_CHECK_SUBSCRIBER_ELIGIBILITY: "chat:check-subscriber-eligibility",
  // Kick send-window IPC bridge. The send-window owns electron BrowserWindow +
  // a webRequest interceptor + the kick.com session bearer — all main-only.
  // Renderer goes through these channels so kick-chat.ts stays renderer-safe
  // (no transitive better-sqlite3 / electron import via channel-endpoints).
  KICK_CHAT_ENSURE_SEND_WINDOW_READY: "kick-chat:ensure-send-window-ready",
  KICK_CHAT_SET_SEND_WINDOW_COMPOSER_RETENTION: "kick-chat:set-send-window-composer-retention",
  KICK_CHAT_SEND_MESSAGE: "kick-chat:send-message",
  KICK_CHAT_BAN_USER: "kick-chat:ban-user",
  KICK_CHAT_TIMEOUT_USER: "kick-chat:timeout-user",
  KICK_CHAT_UNBAN_USER: "kick-chat:unban-user",
  KICK_CHAT_DELETE_MESSAGE: "kick-chat:delete-message",
  KICK_CHAT_GET_VIEWER_ROLE: "kick-chat:get-viewer-role",
  KICK_CHAT_PIN_MESSAGE: "kick-chat:pin-message",
  KICK_CHAT_UNPIN_MESSAGE: "kick-chat:unpin-message",
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
  MODERATION_TIMEOUT_SNAPSHOT: "moderation:timeout-snapshot",
  MODERATION_TIMEOUT_SUBMIT: "moderation:timeout-submit",

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

  // ========== Platform Health ==========
  // Pull for hydration on mount; push on every transition with
  // `{ platform, status, startedAt }`. See ADR-0002.
  PLATFORM_HEALTH_GET: "platform-health:get",
  PLATFORM_HEALTH_CHANGED: "platform-health-changed",

  // ========== Logging ==========
  // Renderer → main fire-and-forget: forward a renderer log line to the
  // main-process logger singleton. Sender-origin-checked so a tampered
  // renderer (the main window runs with webSecurity:false) can't spam the
  // session log with garbage.
  LOG_WRITE: "log:write",
  // Open the logs directory in the OS file explorer (Settings → Logs panel).
  LOGS_OPEN_FOLDER: "logs:open-folder",
  // Read the current main session-log path (typically used by Settings UI).
  LOGS_GET_CURRENT_PATH: "logs:get-current-path",
  // Read the noise side-channel log path; returns null if the noise logger
  // is not initialized (it's optional / app-controlled at boot).
  LOGS_GET_NOISE_PATH: "logs:get-noise-path",
  // Read the network side-channel log path; returns null if the logger has
  // not been initialized.
  LOGS_GET_NETWORK_PATH: "logs:get-network-path",
  // Tail the last N lines of either log file for the LogsSection preview.
  LOGS_TAIL: "logs:tail",

  // ========== Slot Controller (slice 04 of renderer-OOM PRD #51) ==========
  // Host → main: renderer drives focus + cap + background-quality settings into
  // the main-process slot-controller. `slot:rebind-existing-slots` is fired by
  // the host after its own crash-recovery reload so main can resync state.
  SLOT_REQUEST_FOCUS: "slot:request-focus",
  SLOT_SET_PLAYBACK_BUDGET: "slot:set-playback-budget",
  SLOT_SET_BACKGROUND_QUALITY: "slot:set-background-quality",
  SLOT_REBIND_EXISTING_SLOTS: "slot:rebind-existing-slots",
  // Main → slot: dispatched via webContents.send. Slice 04 consumer is the
  // host renderer; slice 05+ replaces with per-slot WebContentsView consumers.
  SLOT_LOAD_STREAM: "slot:load-stream",
  SLOT_SET_MUTE: "slot:set-mute",
  SLOT_SET_QUALITY: "slot:set-quality",
  SLOT_SET_BUFFER_CONFIG: "slot:set-buffer-config",
  SLOT_UNLOAD: "slot:unload",
  // Slot → main: lifecycle and metrics signals from the slot consumer. Wired
  // in slice 04, exercised in slice 05+ once a real WCV emits.
  SLOT_CRASHED: "slot:crashed",
  SLOT_METRICS: "slot:metrics",
  SLOT_PLAYBACK_EVENT: "slot:playback-event",
  // Main → host: notify when slot presence changes so chrome (active outline,
  // mute icons) can re-render.
  SLOT_PRESENCE_CHANGED: "slot:presence-changed",
  // Main → host: fired after a slot's WCV crashes for the SECOND time in the
  // 5-min window. Host renderer responds by showing a "Stream crashed — click
  // to retry" overlay in the slot's chrome. Slice 06 of PRD #51.
  SLOT_RETRY_AFFORDANCE: "slot:retry-affordance",
  // Host → main: user clicked the retry overlay. Main rebuilds the slot's
  // WCV + replays the last loadStream payload. Slice 06.
  SLOT_REQUEST_RETRY: "slot:request-retry",
  // Host → main: push slot rect (x, y, width, height) from the React grid's
  // ResizeObserver so main can position the WCV under the host renderer's
  // placeholder div. Slice 06 host-side rewrite of stream-slot.tsx.
  SLOT_SET_BOUNDS: "slot:set-bounds",
  // Host → main: create or destroy a slot on the controller (mirrors the
  // host's multistream-store streams list). Slice 06 lifecycle wiring.
  SLOT_CREATE: "slot:create",
  SLOT_DESTROY: "slot:destroy",
  // Host → main: dispatch a load-stream into a specific slot. The host
  // resolves the playback URL via its existing stream-playback hook and
  // pushes it down so the slot WCV's renderer (slot-renderer/main.ts) has
  // something to play. Slice 06.
  SLOT_LOAD_STREAM_REQUEST: "slot:load-stream-request",
  // Host queries this on mount to decide whether to render the legacy
  // in-process player or the WCV placeholder + ResizeObserver path. Slice 06
  // — once the flag is flipped to default-on, this will always return true
  // and the legacy path is removed.
  SLOT_IS_WCV_ENABLED: "slot:is-wcv-enabled",

  // ========== Third-party emote providers ==========
  // 7TV / BTTV / FFZ REST calls run in main (Electron `net.fetch`) so
  // renderer DevTools never logs the 404s that fire for channels with no
  // linked / known account. See ADR-0004 and PRD #62.
  EMOTES_7TV_GET_USER_BY_CONNECTION: "emotes:7tv:get-user-by-connection",
  EMOTES_7TV_GET_GLOBAL_EMOTE_SET: "emotes:7tv:get-global-emote-set",
  EMOTES_BTTV_GET_BADGES: "emotes:bttv:get-badges",
  EMOTES_BTTV_GET_GLOBAL: "emotes:bttv:get-global",
  EMOTES_BTTV_GET_USER_BY_TWITCH_ID: "emotes:bttv:get-user-by-twitch-id",
  EMOTES_FFZ_GET_BADGES: "emotes:ffz:get-badges",
  EMOTES_FFZ_GET_GLOBAL: "emotes:ffz:get-global",
  EMOTES_FFZ_GET_ROOM: "emotes:ffz:get-room",
  EMOTES_KICK_GET_CHANNEL_EMOTES: "emotes:kick:get-channel-emotes",
  EMOTES_KICK_GET_USER_SUBSCRIPTIONS: "emotes:kick:get-user-subscriptions",

  // ========== Diagnostics ==========
  DIAGNOSTICS_OPEN_LEASE: "diagnostics:open-lease",
  DIAGNOSTICS_CONFIGURE_LEASE: "diagnostics:configure-lease",
  DIAGNOSTICS_CLOSE_LEASE: "diagnostics:close-lease",
  DIAGNOSTICS_REFRESH: "diagnostics:refresh",
  DIAGNOSTICS_REPORT_RENDERER: "diagnostics:report-renderer",
  DIAGNOSTICS_SNAPSHOT_CHANGED: "diagnostics:snapshot-changed",

  // ========== Bug Reports ==========
  // Renderer-driven bug-report capture. The handler stitches the description,
  // tail of the main log, and tail of the noise log into a markdown file in
  // the bug-reports directory (sibling of logs — see log-paths.ts).
  BUG_REPORT_WRITE: "bug-report:write",
  // Reveal the bug-reports directory in the OS file explorer.
  BUG_REPORT_OPEN_FOLDER: "bug-report:open-folder",
  // Read the absolute path of the bug-reports directory (UI hint).
  BUG_REPORT_GET_DIR: "bug-report:get-dir",
  // List recent bug-report file paths, newest first, capped at 50.
  BUG_REPORT_LIST: "bug-report:list",
} as const;

export const IPC_FEATURES = {
  ADBLOCK: "adblock",
  APP: "app",
  AUTH: "auth",
  BUG_REPORTS: "bug-reports",
  CATEGORIES: "categories",
  CHANNELS: "channels",
  CHAT: "chat",
  CHAT_ELIGIBILITY: "chat-eligibility",
  CHAT_REPLAY: "chat-replay",
  CONNECTIVITY: "connectivity",
  DOWNLOADS: "downloads",
  DIAGNOSTICS: "diagnostics",
  EMOTES: "emotes",
  KICK_CHAT: "kick-chat",
  LOCAL_CAPTIONS: "local-captions",
  LOGS: "logs",
  MOD_LOG: "mod-log",
  NOTIFICATIONS: "notifications",
  PLAYBACK: "playback",
  PLATFORM_HEALTH: "platform-health",
  PROXY: "proxy",
  SEARCH: "search",
  SLOTS: "slots",
  STREAM_RECORDING: "stream-recording",
  STREAMS: "streams",
  STORAGE: "storage",
  SYSTEM: "system",
  TIMEOUT_MODERATION: "timeout-moderation",
  TOKEN_STATUS: "token-status",
  TWITCH_API: "twitch-api",
  UPDATES: "updates",
  USER_PROFILE: "user-profile",
  VIDEOS: "videos",
} as const;

export type IpcFeature = (typeof IPC_FEATURES)[keyof typeof IPC_FEATURES];

// Type for channel names
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type KickSendWindowComposerRetentionChange =
  { kind: "retain"; leaseId: string } | { kind: "release"; leaseId: string };

export type StreamPlaybackRequestIntent = "play" | "recover";

export interface StreamPlaybackRequest {
  platform: Platform;
  channelSlug: string;
  intent: StreamPlaybackRequestIntent;
}

export interface FollowedStreamsRequest {
  platform?: Platform;
}

// ========== Payload Types for IPC Calls ==========

export interface IpcPayloads {
  [IPC_CHANNELS.IPC_FEATURE_LOAD]: IpcFeature;

  [IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE]: {
    documentInstanceId: string;
    view: import("./diagnostics-types").DiagnosticsView;
  };
  [IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE]: {
    leaseId: string;
    view: import("./diagnostics-types").DiagnosticsView;
  };
  [IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE]: { leaseId: string };
  [IPC_CHANNELS.DIAGNOSTICS_REFRESH]: { leaseId: string };
  [IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER]: import("./diagnostics-types").RendererPerformanceSummary;

  // Generic storage
  [IPC_CHANNELS.STORE_GET]: { key: string };
  [IPC_CHANNELS.STORE_SET]: { key: string; value: unknown };
  [IPC_CHANNELS.STORE_DELETE]: { key: string };

  // Theme
  [IPC_CHANNELS.THEME_SET]: { theme: "light" | "dark" | "system" };

  // Auth tokens
  [IPC_CHANNELS.AUTH_TOKEN_STATUS]: { platform: Platform };
  [IPC_CHANNELS.TWITCH_API_EXECUTE]: TwitchApiCommand;
  [IPC_CHANNELS.TWITCH_EVENTSUB_START]: { feedId: string; userId: string; channelId: string };
  [IPC_CHANNELS.TWITCH_EVENTSUB_STOP]: { feedId: string };
  [IPC_CHANNELS.AUTH_GET_TOKEN]: { platform: "kick" };
  [IPC_CHANNELS.AUTH_SAVE_TOKEN]: { platform: "kick"; token: AuthToken };
  [IPC_CHANNELS.AUTH_CLEAR_TOKEN]: { platform: Platform };
  [IPC_CHANNELS.AUTH_HAS_TOKEN]: { platform: Platform };
  [IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED]: { platform: Platform };
  [IPC_CHANNELS.AUTH_SYNC_FOLLOWS]: { platform: Platform };
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
  [IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT]: KickAccountFollowWriteRequest;

  // Preferences
  [IPC_CHANNELS.PREFERENCES_UPDATE]: { updates: Partial<UserPreferences> };

  // Stream proxy — config carries host/port/enabled only (no credentials).
  [IPC_CHANNELS.PROXY_APPLY]: { config: ProxyApplyConfig };
  // Credentials are write-only: a null clears the stored pair; a value stores
  // it encrypted. The password is never returned by any channel.
  [IPC_CHANNELS.PROXY_SET_CREDENTIALS]: { credentials: ProxyCredentialsInput | null };

  [IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL]: StreamPlaybackRequest;
  [IPC_CHANNELS.STREAMS_GET_FOLLOWED]: FollowedStreamsRequest;

  // External links
  [IPC_CHANNELS.SHELL_OPEN_EXTERNAL]: { url: string };

  // Notifications
  [IPC_CHANNELS.NOTIFICATION_SHOW]: { title: string; body: string };

  // Downloads
  [IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP]: ClipDownloadRequest;
  [IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO]: VideoDownloadRequest;
  [IPC_CHANNELS.DOWNLOADS_PAUSE]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_RESUME]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_CANCEL]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_RETRY]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_REMOVE]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_OPEN_FILE]: { id: string };
  [IPC_CHANNELS.DOWNLOADS_DELETE_FILE]: { id: string };

  // Chat Replay
  [IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW]: ChatReplayIpcWindowRequest;
  [IPC_CHANNELS.VIDEOS_CANCEL_CHAT_REPLAY_WINDOW]: CancelChatReplayWindowRequest;

  // Category media
  [IPC_CHANNELS.CLIPS_GET_BY_CATEGORY]: CategoryClipsRequest;
  [IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY]: CategoryVideosRequest;

  // Stream Recording
  [IPC_CHANNELS.STREAM_RECORDING_START]: StreamRecordingRequest;
  [IPC_CHANNELS.STREAM_RECORDING_STOP]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_DISCARD]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_PAUSE]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_RESUME]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED]: {
    sessionId: string;
    confirmed?: boolean;
  };
  [IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED]: { sessionId: string };
  [IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE]: { sessionId: string };

  // Local Captions
  [IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START]: LocalCaptionSessionIdentity;
  [IPC_CHANNELS.LOCAL_CAPTIONS_AUDIO_PUSH]: LocalCaptionPcmChunk;
  [IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_STOP]: LocalCaptionSessionIdentity;

  // App auto-update — auto-check toggle + frequency (U15). Either field is
  // optional so the renderer can update one without resending the other.
  [IPC_CHANNELS.UPDATE_SET_AUTO_CHECK]: {
    enabled?: boolean;
    frequency?: CheckFrequency;
    updateCheckUrl?: string;
  };

  // Kick chat send — chatroomId addresses the v2 broadcast endpoint; content
  // is the raw message text. ensure-ready and dispose take no payload.
  [IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS]: {
    platform: Platform;
    channel?: string;
    users: Array<{ userId?: string; username: string }>;
  };
  [IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE]: { channel: string };
  [IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG]: {
    broadcasterId: string;
    channelLogin: string;
    forceRefresh?: boolean;
  };
  [IPC_CHANNELS.CHAT_CHECK_SUBSCRIBER_ELIGIBILITY]: SubscriberEligibilityRequest;
  [IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE]: {
    chatroomId: number;
    content: string;
    channelSlug?: string;
  };
  [IPC_CHANNELS.KICK_CHAT_SET_SEND_WINDOW_COMPOSER_RETENTION]: KickSendWindowComposerRetentionChange;
  [IPC_CHANNELS.KICK_CHAT_BAN_USER]: {
    channelSlug: string;
    username: string;
  };
  [IPC_CHANNELS.KICK_CHAT_TIMEOUT_USER]: {
    channelSlug: string;
    username: string;
    duration: number;
  };
  [IPC_CHANNELS.KICK_CHAT_UNBAN_USER]: {
    channelSlug: string;
    username: string;
  };
  [IPC_CHANNELS.KICK_CHAT_DELETE_MESSAGE]: {
    chatroomId: number;
    messageId: string;
  };
  [IPC_CHANNELS.KICK_CHAT_PIN_MESSAGE]: {
    channelSlug: string;
    messageId: string;
    chatroomId: number;
    content: string;
    sender: { id: number; username: string; slug?: string; identity?: unknown };
    durationSeconds: number | null;
  };
  [IPC_CHANNELS.KICK_CHAT_UNPIN_MESSAGE]: {
    channelSlug: string;
  };
  [IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT]: TimeoutActionBinding;
  [IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT]: TimeoutSubmitInput;

  // Renderer → main log bridge. `level` is restricted to the four supported
  // severities; the handler drops anything else. `tag` is prefixed with
  // `Renderer:` before reaching the logger so the file format stays unambiguous.
  [IPC_CHANNELS.LOG_WRITE]: {
    level: "debug" | "info" | "warn" | "error";
    tag: string;
    message: string;
    meta?: Record<string, unknown>;
  };
  // Tail a log file. `file` selects the main session log, network side-channel,
  // or optional noise log; `lines` is clamped to [1, 5000] by the handler. Optional
  // `level`/`tag` filters apply server-side BEFORE the tail-slice, so a
  // tag/level match deep in the file isn't dropped by a small `lines`
  // window. `tag` is a case-insensitive substring match. `query` matches
  // against the whole line, OR-ing multiple values.
  [IPC_CHANNELS.LOGS_TAIL]: {
    lines: number;
    file: "main" | "noise" | "network";
    level?: "debug" | "info" | "warn" | "error";
    tag?: string;
    query?: string | string[];
  };

  // Bug-report capture. `description` is the user's free-form text; the two
  // include flags pick whether the handler tails the main and noise logs into
  // the saved markdown file.
  [IPC_CHANNELS.BUG_REPORT_WRITE]: {
    description: string;
    includeMainLog: boolean;
    includeNoiseLog: boolean;
  };

  // Slot-controller IPC payloads (slice 04 of #51).
  [IPC_CHANNELS.SLOT_REQUEST_FOCUS]: { slotId: string };
  [IPC_CHANNELS.SLOT_SET_PLAYBACK_BUDGET]: { budget: number };
  [IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY]: { mode: SlotQualityMode };
  [IPC_CHANNELS.SLOT_REQUEST_RETRY]: { slotId: string };
  [IPC_CHANNELS.SLOT_SET_BOUNDS]: {
    slotId: string;
    rect: { x: number; y: number; width: number; height: number };
  };
  [IPC_CHANNELS.SLOT_CREATE]: { slotId: string };
  [IPC_CHANNELS.SLOT_DESTROY]: { slotId: string };
  [IPC_CHANNELS.SLOT_LOAD_STREAM_REQUEST]: {
    slotId: string;
    payload: { platform: Platform; channelName: string; playbackUrl: string };
  };
}

export interface BTTVBadgeCatalogEntry {
  providerId: string;
  badge: {
    description: string;
    svg: string;
  };
}

export type BTTVBadgeCatalog = BTTVBadgeCatalogEntry[];

export interface FFZImageUrls {
  "1": string;
  "2"?: string;
  "4"?: string;
}

export interface FFZBadgeCatalog {
  badges: Array<{
    id: number;
    title: string;
    color: string;
    slot?: number;
    replaces?: string;
    urls: FFZImageUrls;
  }>;
  users: Record<string, Array<string | number>>;
}

export interface FFZRoomResponse {
  room: {
    _id?: number;
    twitch_id?: number | string;
    id?: string;
    is_group?: boolean;
    display_name?: string;
    set: number;
    vip_badge?: FFZImageUrls | null;
    mod_urls?: FFZImageUrls | null;
    moderator_badge?: string | null;
  };
  sets: Record<string, unknown>;
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

/**
 * Snapshot of the runtime environment exposed via `APP_GET_ENVIRONMENT`. The
 * renderer Settings UI uses `isDev` to dev-gate the LogsSection, and the
 * bug-report feature embeds the version triple in every report so issue
 * threads stay cross-referenceable to a specific build.
 */
export interface AppEnvironment {
  /** True when `app.isPackaged` is false — i.e. running under electron-vite dev. */
  isDev: boolean;
  /** Node platform identifier ("win32" / "darwin" / "linux" / ...). */
  platform: NodeJS.Platform;
  /** `app.getVersion()` — the productName-anchored SemVer string. */
  appVersion: string;
  /** Electron runtime version (process.versions.electron). */
  electronVersion: string;
  /** Node runtime version bundled into Electron (process.versions.node). */
  nodeVersion: string;
}

/** Main-process observation of the operating system's physical network state. */
export type PhysicalConnectivityResult = { status: "online" } | { status: "offline" };

/**
 * Result of a `BUG_REPORT_WRITE` call. `filePath` is set on success; `error`
 * is set on failure. Both should never be populated simultaneously.
 */
export interface BugReportResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

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

export type TwitchAuthRefreshResult =
  | {
      success: true;
      user: TwitchUser | null;
      hasToken: boolean;
      isExpired: boolean;
    }
  | { success: false; error: string };

export type AuthSyncFollowsResult =
  | {
      success: true;
      count?: number;
      pendingCount?: number;
      addedCount?: number;
      removedCount?: number;
    }
  | { success: false; error: string };

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
  "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

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
  updateCheckUrl: string;
}

export interface UpdateSettings {
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: CheckFrequency;
  updateCheckUrl: string;
}

/** A renderer-safe IPC response whose success and failure states cannot overlap. */
export type IpcResult<T> =
  | { success: true; data: T; error?: never; retryAfterMs?: never }
  | { success: false; data?: never; error: string; retryAfterMs?: number };

/** A paginated IPC response with optional diagnostics on successful requests. */
export type PaginatedIpcResult<T> =
  | { success: true; data: T; cursor?: string; debug?: string; error?: never }
  | { success: false; data?: never; cursor?: never; debug?: never; error: string };
