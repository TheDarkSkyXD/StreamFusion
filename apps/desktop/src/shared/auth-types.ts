/**
 * Authentication Type Definitions
 *
 * Shared type definitions for authentication across main and renderer processes.
 */

// ========== Platform Types ==========

import type { Platform } from "@streamfusion/core/platform";

export type { Platform };

/** Public client ID for StreamFusion's registered Twitch Device Code app. */
export const TWITCH_APP_CLIENT_ID = "blckgzwqbwms1gmz9l4dup88k7kqk5";

// ========== Token Types ==========

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in milliseconds
  scope?: string[];
  /** OAuth grant family that issued this persisted token. */
  authFlow?: "device-code";
}

export interface EncryptedToken {
  encrypted: string; // Base64 encoded encrypted token
  /** Absent only on records written before the encoding discriminator existed. */
  encoding?: "safeStorage" | "base64";
  iv?: string; // Initialization vector if needed
}

// ========== Twitch OAuth Scopes ==========

/**
 * Canonical Twitch user-token scope set for the current app.
 *
 * Initial connect, reconnect/scope-upgrade, and device-code flows must all
 * request this full list. Existing installs may need one reconnect after a new
 * scope ships, but after that reconnect the token should carry every scope
 * StreamFusion currently uses.
 */
export const TWITCH_APP_SCOPES = [
  "user:read:email",
  "user:read:follows",
  "user:read:subscriptions",
  "user:read:emotes",
  // IRC chat auth. Helix moderation scopes do not unlock tmi.js read/write.
  "chat:read",
  "chat:edit",
  "user:write:chat",
  "user:manage:chat_color",
  "user:manage:blocked_users",
  // Mod-channel discovery and chat message moderation.
  "user:read:moderated_channels",
  "moderator:read:followers",
  "moderator:read:blocked_terms",
  "moderator:read:chat_settings",
  "moderator:read:moderators",
  "moderator:read:vips",
  "moderator:manage:chat_messages",
  "moderator:manage:chat_settings",
  "moderator:manage:announcements",
  "moderator:manage:shoutouts",
  "moderator:manage:suspicious_users",
  // Channel-management console actions.
  "moderator:manage:banned_users",
  "moderator:manage:warnings",
  "moderator:manage:shield_mode",
  "channel:manage:raids",
  "channel:manage:moderators",
  "channel:manage:vips",
  "channel:manage:predictions",
  "channel:manage:polls",
  "channel:edit:commercial",
  "channel:manage:broadcast",
  "user:manage:whispers",
  // Unban-request review and decisions.
  "moderator:read:unban_requests",
  "moderator:manage:unban_requests",
] as const;

export type TwitchAppScope = (typeof TWITCH_APP_SCOPES)[number];

/**
 * Canonical scope from each permission group required by
 * `channel.moderate` EventSub v2.
 */
export const TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES = [
  "moderator:read:blocked_terms",
  "moderator:read:chat_settings",
  "moderator:read:unban_requests",
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:manage:warnings",
  "moderator:read:moderators",
  "moderator:read:vips",
] as const satisfies readonly TwitchAppScope[];

/**
 * Twitch accepts either permission in the first six groups. `canonical`
 * is the scope StreamFusion requests when reconnecting.
 */
export const TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPE_GROUPS = [
  {
    canonical: "moderator:read:blocked_terms",
    accepted: ["moderator:read:blocked_terms", "moderator:manage:blocked_terms"],
  },
  {
    canonical: "moderator:read:chat_settings",
    accepted: ["moderator:read:chat_settings", "moderator:manage:chat_settings"],
  },
  {
    canonical: "moderator:read:unban_requests",
    accepted: ["moderator:read:unban_requests", "moderator:manage:unban_requests"],
  },
  {
    canonical: "moderator:manage:banned_users",
    accepted: ["moderator:read:banned_users", "moderator:manage:banned_users"],
  },
  {
    canonical: "moderator:manage:chat_messages",
    accepted: ["moderator:read:chat_messages", "moderator:manage:chat_messages"],
  },
  {
    canonical: "moderator:manage:warnings",
    accepted: ["moderator:read:warnings", "moderator:manage:warnings"],
  },
  {
    canonical: "moderator:read:moderators",
    accepted: ["moderator:read:moderators"],
  },
  {
    canonical: "moderator:read:vips",
    accepted: ["moderator:read:vips"],
  },
] as const satisfies ReadonlyArray<{
  canonical: (typeof TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES)[number];
  accepted: readonly string[];
}>;

export const KICK_APP_SCOPES = [
  "user:read",
  "channel:read",
  "chat:write",
  "moderation:chat_message:manage",
  "moderation:ban",
  "events:subscribe",
] as const;

export type KickAppScope = (typeof KICK_APP_SCOPES)[number];

export const TWITCH_MOD_ACTION_SCOPES = [
  "user:read:moderated_channels",
  "moderator:manage:chat_messages",
] as const satisfies readonly TwitchAppScope[];

// ========== User Types ==========

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
  email?: string;
  createdAt: string;
  broadcasterType: "partner" | "affiliate" | "";
}

export interface KickUser {
  id: number;
  username: string;
  slug: string;
  profilePic: string;
  email?: string;
  bio?: string;
  verified: boolean;
  twitter?: string;
  discord?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  youtube?: string;
}

export type PlatformUser = TwitchUser | KickUser;

// ========== Follow Types ==========

/**
 * Source tag on a follow row (post-2026-05-29 source-collapse).
 *   - "guest": local follow, visible when no live token exists for that platform.
 *   - "kick" / "twitch": account follow confirmed by platform sync; visible
 *     only while signed in. The platform value matches the row's platform column.
 *
 * Legacy "account" and "local" values are migrated at DB init to the
 * platform name — see `database-service.ts#init()`.
 */
export type FollowSource = "guest" | Platform;

export interface LocalFollow {
  id: string; // Unique identifier (generated)
  platform: Platform;
  channelId: string;
  channelName: string; // Username/login
  displayName: string;
  profileImage: string;
  followedAt: string; // ISO date string
  lastSeen?: string; // ISO date string
  isLive?: boolean;
  notifications?: boolean;
  /** Set server-side. Platform values mean the follow was confirmed by account sync. */
  source?: FollowSource;
}

export interface KickAccountFollowWriteRequest {
  action: "follow" | "unfollow";
  follow: Omit<LocalFollow, "id" | "followedAt"> & { platform: "kick" };
}

export interface TwitchAccountFollowWriteRequest {
  action: "follow" | "unfollow";
  follow: Omit<LocalFollow, "id" | "followedAt"> & { platform: "twitch" };
}

export type AccountFollowWriteRequest =
  KickAccountFollowWriteRequest | TwitchAccountFollowWriteRequest;

export interface KickAccountFollowWriteSnapshot {
  status: "pending" | "retrying" | "auth-paused" | "failed";
  action: "follow" | "unfollow";
  target: {
    platform: "kick";
    channelId: string;
    channelName: string;
  };
  createdAt: string;
  attemptedAt: string;
  nextAttemptAt: string;
  expiresAt: string;
  attemptCount: number;
  lastError: string | null;
}

export type KickAccountFollowWriteResult =
  | {
      status: "confirmed" | "pending" | "auth-paused" | "failed";
      activeFollows: LocalFollow[];
    }
  | {
      status: "rejected";
      activeFollows: LocalFollow[];
      error: string;
    };

export type AccountFollowWriteResult = KickAccountFollowWriteResult;

export interface KickAccountFollowWriteChangedEvent {
  status: "confirmed" | "pending" | "auth-paused" | "failed";
  action: "follow" | "unfollow";
  target: {
    platform: "kick";
    channelId: string;
    channelName: string;
  };
  activeFollows: LocalFollow[];
  /** Sanitized backend reason code for terminal account-write failures. */
  reason?: string;
}

export interface LiveNotificationPayload {
  id: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  title: string;
  createdAt: number;
  channelAvatar?: string | null;
}

export type DesktopNotificationPermissionStatus =
  "granted" | "denied" | "default" | "unsupported" | "unknown";

export type LiveNotificationCoverageIssueReason =
  | "eventsub-failed"
  | "subscription-limit"
  | "subscription-revoked"
  | "polling-failed"
  | "polling-limited"
  | "platform-health"
  | "many-follows";

export interface LiveNotificationCoverageIssue {
  platform: Platform;
  reason: LiveNotificationCoverageIssueReason;
  message: string;
  safeContext?: Record<string, string | number | boolean | null>;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface PlatformLiveNotificationCoverage {
  status: "normal" | "degraded";
  issues: LiveNotificationCoverageIssue[];
}

export interface DesktopNotificationCoverageStatus {
  supported: boolean;
  permission: DesktopNotificationPermissionStatus;
}

export interface LiveNotificationCoverageStatus {
  desktop: DesktopNotificationCoverageStatus;
  platforms: Record<Platform, PlatformLiveNotificationCoverage>;
}

export interface TwitchFollow {
  userId: string;
  userLogin: string;
  userName: string;
  followedAt: string;
}

export interface KickFollow {
  channelId: number;
  slug: string;
  username: string;
  followedAt: string;
}

// ========== Preferences Types ==========

export type Theme = "light" | "dark" | "system";
export type VideoQuality =
  "auto" | "highest" | "1440p" | "2k" | "1080p" | "720p" | "480p" | "360p" | "160p";
export type ChatPosition = "right" | "left" | "hidden";
export type ChatSize = "small" | "medium" | "large";

export interface NotificationPreferences {
  enabled: boolean;
  liveAlerts: boolean;
  twitch: boolean;
  kick: boolean;
  guestFollows: boolean;
  toastAlerts: boolean;
  sound: boolean;
  favoriteChannelsOnly: boolean;
  restartGracePeriodMinutes: 0 | 5 | 15 | 30;
  perChannelNotifications: Record<string, boolean>;
}

export interface ChatPreferences {
  position: ChatPosition;
  size: ChatSize;
  timestamps: boolean;
  badges: boolean;
  emotes: boolean;
  fontScale: number; // 0.8 - 1.5
}

export interface PlaybackPreferences {
  autoPlay: boolean;
  defaultQuality: VideoQuality;
  lowLatency: boolean;
  theaterMode: boolean;
  volume: number; // 0-1
  muted: boolean;
}

/**
 * Advanced/Developer preferences.
 * These settings control behavior that may have security or compliance implications.
 */
export interface AdvancedPreferences {
  /**
   * Enable image proxy for blocked CDN images (e.g., Kick offline banners).
   *
   * When enabled, the app will spoof request headers (Referer, User-Agent) to
   * bypass hotlinking restrictions on certain CDNs. This is necessary because:
   * - Kick CDN (files.kick.com) returns 403 Forbidden without proper Referer header
   * - Desktop apps cannot set Referer headers from the renderer process
   *
   * @default true (enabled for better UX, but can be disabled)
   */
  enableImageProxy: boolean;
}

/**
 * Viewer-facing prediction widget preferences. The widget renders one of two
 * visual styles selected by the user — see viewer-prediction plan (U1, U8).
 */
export interface PredictionPreferences {
  /**
   * `native` (default) renders the widget in each platform's native styling
   * (Twitch purple with color-keyed side blocks and bubble chart; Kick green /
   * pink dot pairs). `unified` renders both platforms in StreamFusion's storm
   * accent for cross-platform consistency.
   */
  style: "native" | "unified";
}

/**
 * Visibility of the player chrome controls (Twitch + Kick, live + VOD).
 *
 * Its own top-level group so older installs hydrate the whole group with
 * defaults under the shallow top-level preferences merge. Each flag gates ONLY
 * the chrome — hiding a control never disables the underlying capability
 * (hiding Volume removes the button but audio keeps playing; hiding Quality
 * removes the menu item but the selected quality is unchanged). Controls that
 * are naturally absent on a surface (e.g. playback speed on live) stay absent
 * regardless of the flag. Fields cover only the controls that exist today —
 * see plan U8. (Xtra port.)
 */
export interface PlayerControlsPreferences {
  showQuality: boolean;
  showPlaybackSpeed: boolean;
  showVolume: boolean;
  showFullscreen: boolean;
  showTheater: boolean;
  showPictureInPicture: boolean;
  showVideoStats: boolean;
}

/**
 * Live playback buffer / latency tuning, applied to the HLS.js config at the
 * `new Hls({...})` construction site for LIVE streams on both platforms (Twitch
 * runs its own ad-block-aware player; Kick live + both VOD paths share one).
 *
 * Its own top-level group so older installs hydrate the whole group with
 * defaults under the shallow top-level preferences merge. Defaults favor
 * stability over minimum latency; users who want lower delay can still reduce
 * these in Settings.
 *
 * The latency knob maps to `liveSyncDurationCount` (segment count) rather than
 * `liveSyncDuration` (seconds): the count is what both players already used, the
 * sibling `liveMaxLatencyDurationCount` is also count-based, and HLS.js treats
 * the seconds form as a mutually-exclusive override — keeping the family
 * count-based avoids mixing the two. These keys are live-only (inert on VOD), so
 * the consumer applies the group only on the LIVE path. See plan U10. (Xtra port.)
 */
export interface BufferPreferences {
  /** HLS.js `lowLatencyMode`. */
  lowLatencyMode: boolean;
  /**
   * Target live latency as a count of segments from the live edge
   * (HLS.js `liveSyncDurationCount`). Lower = closer to live, less stable.
   */
  liveSyncDurationCount: number;
  /** Forward buffer length in seconds (HLS.js `maxBufferLength`). */
  maxBufferLengthSec: number;
  /** Hard cap on buffer length in seconds (HLS.js `maxMaxBufferLength`). */
  maxMaxBufferLengthSec: number;
}

/**
 * Outbound HTTP/HTTPS proxy for Twitch stream requests, applied in the Electron
 * MAIN process via `session.defaultSession.setProxy(...)`. Off by default; an
 * empty `host` is a safe no-op (clears any prior proxy, never breaks requests).
 *
 * Its own top-level group so older installs hydrate the whole group with
 * defaults under the shallow top-level preferences merge.
 *
 * EGRESS-SPIKE FINDING (plan U11, R19/R20): the main BrowserWindow uses
 * `session.defaultSession` (no `partition`/`session` in webPreferences), so the
 * three target classes — playback access token (`fetch("https://gql.twitch.tv
 * /gql")` in the renderer ad-block service AND the main token path), the
 * multivariant playlist, and the media playlist (renderer HLS.js `fetch`/XHR +
 * the main-process manifest proxy's `fetch`) — ALL egress through
 * `defaultSession`. `session.setProxy` is session-level (all-or-nothing): it
 * applies to every request on that session and CANNOT select by request class.
 *
 * Therefore per-class selectivity (token vs multivariant vs media
 * independently) is NOT achievable with `setProxy`, and this group deliberately
 * carries NO per-class flags — three toggles that don't function would be worse
 * than one honest switch. `enabled` routes ALL of the window session's traffic
 * (the three Twitch stream classes plus everything else on defaultSession)
 * through the proxy. The Kick CDN partition (`persist:kick-cdn-direct`) is set
 * to `mode:"direct"` separately, so Kick CDN images bypass the proxy.
 *
 * The proxy username/password are NOT in this group — they are encrypted via
 * Electron `safeStorage` in the main process (mirroring the OAuth-token path)
 * and never round-tripped to the renderer or carried by `PREFERENCES_GET`.
 * See plan U11.
 */
export interface ProxyPreferences {
  /** Master switch. When false (default), no proxy is applied. */
  enabled: boolean;
  /** Proxy host, no scheme (e.g. "127.0.0.1"). Empty = safe no-op. */
  host: string;
  /** Proxy port (1–65535). `null` when unset. */
  port: number | null;
  /**
   * Read-only hint for the renderer/UI: whether encrypted proxy credentials are
   * currently stored in the main process. Never carries the credential values.
   * Maintained by the main process; the renderer treats it as advisory only.
   */
  hasCredentials: boolean;
}

/** A user-configured Twitch playlist proxy source. Array order is fallback order. */
export interface TwitchPlaylistProxySource {
  id: string;
  /** HLS playlist template. `$channel` is replaced with the Twitch channel name. */
  url: string;
  enabled: boolean;
  /** Add source, audio-only, and low-latency query parameters to the playlist request. */
  addQueryParams: boolean;
}

/**
 * Ordered playlist routing for Twitch live streams. This remains separate
 * from `ProxyPreferences`, which configures the session-wide transport proxy.
 */
export interface TwitchPlaylistProxyPreferences {
  enabled: boolean;
  sources: TwitchPlaylistProxySource[];
}

export type TimestampFormat =
  "H:mm" | "HH:mm" | "H:mm:ss" | "HH:mm:ss" | "h:mm a" | "hh:mm a" | "h:mm:ss a" | "hh:mm:ss a";
export type ChatDensity = "cozy" | "compact" | "loose";
export type ChatPauseMode = "scroll" | "mouseover" | "alt" | "mouseover-alt";
export type DeletedMessageDisplayMode = "tombstone" | "message" | "compact" | "audit";
export type ModerationHighlightStyle = "compact" | "cozy";

/**
 * Viewer-facing chat display preferences (Twitch + Kick unified renderer).
 *
 * Its own top-level group — distinct from the legacy `ChatPreferences`
 * (position/size) — so older installs hydrate the whole group with defaults
 * under the shallow top-level preferences merge. Appearance fields live-apply
 * to the renderer. Badge and username-paint cosmetics are render-time switches
 * and live-apply; emote-provider and event toggles apply on the next channel
 * load. (Xtra port — see plan U1–U5.)
 */
export interface ChatDisplayPreferences {
  // Appearance
  boldUsernames: boolean;
  /** Assign a deterministic readable color to users with no chosen color. */
  readableColorForUncolored: boolean;
  /** Lift low-contrast username colors for the dark theme. */
  themeAdaptUsernameColor: boolean;
  timestamps: boolean;
  timestampFormat: TimestampFormat;
  fontSizePx: number; // ~10-20
  emoteSizePx: number; // ~16-56
  density: ChatDensity;
  hoverSmooth: boolean;
  /** Twitch-style pause-chat trigger. Scrolling the chat pane always pauses. */
  pauseMode: ChatPauseMode;
  /** Docked chat panel width as a percentage of the stream area (Stream/MultiStream pages, U2). */
  chatWidthPct: number; // 0-100
  /** Quick appearance width preset for the chat panel. */
  chatWidthPx: 280 | 340 | 420;
  // Emotes & badges
  /** Show the quick-emote action bar. */
  quickEmotes: boolean;
  enable7tv: boolean;
  enableBttv: boolean;
  enableFfz: boolean;
  enable7tvBadges: boolean;
  enable7tvUsernamePaints: boolean;
  enableBttvBadges: boolean;
  enableFfzBadges: boolean;
  /** Play animated emotes vs. render a static frame. */
  animatedEmotes: boolean;
  /** Stack zero-width / overlay emotes on the previous emote. */
  overlayEmotes: boolean;
  /** Render emotes inside system / notice messages. */
  systemMessageEmotes: boolean;
  // Messages & events
  showUserNotices: boolean;
  showClearMsg: boolean;
  deletedMessageDisplay: DeletedMessageDisplayMode;
  moderationHighlightStyle: ModerationHighlightStyle;
  showClearChat: boolean;
  firstMsgHighlight: boolean;
  showPolls: boolean;
  showPredictions: boolean;
  /** Ask for a duration before pinning a Twitch chat message. */
  showTwitchPinDurationDialog: boolean;
  recentMessagesOnJoin: boolean;
  recentMessagesLimit: number;
  /**
   * Max messages retained in the live buffer before the oldest are pruned.
   * Default 600, clamped by the consumer to [10, 1200]. Default 600 sits at
   * the midpoint of the settings slider; ceiling 1200 gives headroom above
   * KickTalk's 600-message paused cap while bounding RAM (the array is still
   * a single flat list shared across multiview panels — see Plan C for the
   * per-channel store refactor).
   */
  messageLimit: number;
}

/**
 * Player type for the advanced stream-token override. `"default"` is a sentinel
 * meaning "no override" — the ad-block service keeps its own `DEFAULT_ADBLOCK_CONFIG`
 * player-type list, so an untouched setting is behavior-neutral. The non-default
 * values are exactly the ad-block `PlayerType` union (kept in sync there); they are
 * not re-imported here to keep this shared types module dependency-free.
 */
export type PlaybackAdvancedPlayerType =
  "default" | "site" | "embed" | "popout" | "autoplay" | "picture-by-picture" | "thunderdome";

/**
 * Advanced Twitch stream-token controls, applied ONLY through the ad-block
 * (VAFT) token pipeline via `updateAdBlockConfig`.
 *
 * Its own top-level group so older installs hydrate the whole group with
 * defaults under the shallow top-level preferences merge.
 *
 * SCOPED TO THE AD-BLOCK PATH ONLY (plan U13, R22/R23): the ad-block service
 * requests tokens with the web Client-Id (`kimne…`) paired with integrity
 * headers, while the non-ad-block resolver (`twitch-gql-client.ts`) uses the
 * Android Client-Id (`kd1unb…`) with a hardcoded `playerType:"site"`. The two
 * pairings are not interchangeable — pushing a player-type/codec override into
 * the resolver would trip its integrity check and 401. So these overrides flow
 * through `updateAdBlockConfig` only; when ad-block is OFF the resolver keeps
 * its working defaults and these settings have no effect.
 *
 * Defaults reproduce the current ad-block behavior exactly, so an untouched
 * install is behavior-neutral (R25). Only the controls that map to a REAL,
 * behavior-active `AdBlockConfig` field are present here — see the U13 report
 * for the controls that were dropped because no clean config mapping exists
 * (include-GQL-token, extra stream headers, skip-video-access-token).
 */
export interface PlaybackAdvancedPreferences {
  /**
   * Preferred player type for the ad-block access-token request. `"default"`
   * (the shipped behavior) leaves the ad-block service's own player-type list
   * untouched. A concrete value is tried first for backup streams and used as
   * the fallback player type. Device-id randomize is a separate action (it is
   * not an `AdBlockConfig` field) — see the Settings UI.
   */
  playerType: PlaybackAdvancedPlayerType;
  /**
   * Allow HEVC (H.265) streams to play without swapping to an AVC equivalent.
   * Maps to `AdBlockConfig.skipPlayerReloadOnHevc`. Default `false` reproduces
   * the current behavior (HEVC triggers the AVC swap / player reload during ads
   * so the player doesn't hard-reload mid-stream). Enabling keeps HEVC but can
   * break playback if the decoder can't switch cleanly — hence "advanced".
   */
  allowHevc: boolean;
}

export interface CaptionPreferences {
  enabled: boolean;
  source: "platform" | "local";
  preferredLanguage: string | null;
  localModelId: string | null;
  textSizePercent: number;
  backgroundOpacityPercent: number;
}

export interface UserPreferences {
  theme: Theme;
  language: string;
  notifications: NotificationPreferences;
  chat: ChatPreferences;
  /** Viewer-facing chat display settings (Xtra port, U1). */
  chatDisplay: ChatDisplayPreferences;
  playback: PlaybackPreferences;
  advanced: AdvancedPreferences;
  predictions: PredictionPreferences;
  /** Visibility of the player chrome controls (Xtra port, U8). */
  playerControls: PlayerControlsPreferences;
  /** Live playback buffer / latency tuning (Xtra port, U10). */
  buffer: BufferPreferences;
  /** Outbound Twitch-stream proxy (host/port/enabled only — creds via safeStorage; Xtra port, U11). */
  proxy: ProxyPreferences;
  /** Ordered Twitch playlist-proxy sources used as a custom-ad-block replacement. */
  twitchPlaylistProxy: TwitchPlaylistProxyPreferences;
  /** Advanced Twitch stream-token controls, ad-block path only (Xtra port, U13). */
  playbackAdvanced: PlaybackAdvancedPreferences;
  /** Durable logical caption selection and appearance; runtime track/session state is excluded. */
  captions: CaptionPreferences;
  startMinimized: boolean;
  minimizeToTray: boolean;
}

// ========== Auth Result Types ==========

export interface AuthResult {
  success: boolean;
  platform: Platform;
  user?: PlatformUser;
  error?: AuthError;
}

export type AuthErrorCode =
  | "NETWORK_ERROR"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "USER_CANCELLED"
  | "PERMISSION_DENIED"
  | "UNKNOWN_ERROR";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  platform: Platform;
}

// ========== Default Values ==========

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  liveAlerts: true,
  twitch: true,
  kick: true,
  guestFollows: true,
  toastAlerts: true,
  sound: true,
  favoriteChannelsOnly: false,
  restartGracePeriodMinutes: 0,
  perChannelNotifications: {},
};

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  position: "right",
  size: "medium",
  timestamps: false,
  badges: true,
  emotes: true,
  fontScale: 1,
};

export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  autoPlay: true,
  defaultQuality: "auto",
  lowLatency: true,
  theaterMode: false,
  volume: 0.8,
  muted: false,
};

const DEFAULT_ADVANCED_PREFERENCES: AdvancedPreferences = {
  enableImageProxy: true, // Enabled by default for better UX
};

export const DEFAULT_PREDICTION_PREFERENCES: PredictionPreferences = {
  style: "native",
};

export const DEFAULT_PLAYER_CONTROLS_PREFERENCES: PlayerControlsPreferences = {
  showQuality: true,
  showPlaybackSpeed: true,
  showVolume: true,
  showFullscreen: true,
  showTheater: true,
  showPictureInPicture: true,
  showVideoStats: true,
};

/**
 * Stability-first HLS defaults with a bounded live buffer. The previous
 * latency-first defaults (`lowLatencyMode:true`, liveSync 2) were prone to
 * random buffering on noisy Twitch/Kick CDN moments; the later 30/60s buffer
 * was stable but pushed 1080p live RSS too high for long sessions.
 */
export const DEFAULT_BUFFER_PREFERENCES: BufferPreferences = {
  lowLatencyMode: false,
  liveSyncDurationCount: 4,
  maxBufferLengthSec: 15,
  maxMaxBufferLengthSec: 30,
};

/**
 * Off by default with an empty host, so a fresh install applies no proxy and
 * stream requests are never affected (R21). `hasCredentials` starts false and
 * is set true by the main process once credentials are stored.
 */
export const DEFAULT_PROXY_PREFERENCES: ProxyPreferences = {
  enabled: false,
  host: "",
  port: null,
  hasCredentials: false,
};

export const DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES: TwitchPlaylistProxyPreferences = {
  enabled: true,
  sources: [
    {
      id: "luminous-eu",
      url: "https://eu.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-eu-2",
      url: "https://eu2.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-eu-3",
      url: "https://eu3.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-asia",
      url: "https://as.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu",
      url: "https://lb-eu.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-2",
      url: "https://lb-eu2.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-3",
      url: "https://lb-eu3.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-4",
      url: "https://lb-eu4.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-5",
      url: "https://lb-eu5.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-na",
      url: "https://lb-na.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
    {
      id: "perfprod-sa",
      url: "https://lb-sa.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
    {
      id: "perfprod-asia",
      url: "https://lb-as.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
  ],
};

export const DEFAULT_CHAT_DISPLAY_PREFERENCES: ChatDisplayPreferences = {
  // Appearance
  boldUsernames: false,
  readableColorForUncolored: true,
  themeAdaptUsernameColor: true,
  timestamps: false,
  timestampFormat: "HH:mm",
  fontSizePx: 16,
  emoteSizePx: 28,
  density: "cozy",
  hoverSmooth: true,
  pauseMode: "scroll",
  chatWidthPct: 30,
  chatWidthPx: 340,
  // Emotes & badges
  quickEmotes: true,
  enable7tv: true,
  enableBttv: true,
  enableFfz: true,
  enable7tvBadges: true,
  enable7tvUsernamePaints: true,
  enableBttvBadges: true,
  enableFfzBadges: true,
  animatedEmotes: true,
  overlayEmotes: true,
  systemMessageEmotes: true,
  // Messages & events
  showUserNotices: true,
  showClearMsg: true,
  deletedMessageDisplay: "compact",
  moderationHighlightStyle: "compact",
  showClearChat: true,
  firstMsgHighlight: true,
  showPolls: true,
  showPredictions: true,
  showTwitchPinDurationDialog: true,
  recentMessagesOnJoin: true,
  recentMessagesLimit: 200,
  messageLimit: 600,
};

/**
 * Defaults reproduce the current ad-block token behavior exactly (R25):
 * `playerType:"default"` leaves the ad-block service's own player-type list
 * untouched, and `allowHevc:false` matches `DEFAULT_ADBLOCK_CONFIG`'s
 * `skipPlayerReloadOnHevc:false`. So an untouched install applies no override.
 */
export const DEFAULT_PLAYBACK_ADVANCED_PREFERENCES: PlaybackAdvancedPreferences = {
  playerType: "default",
  allowHevc: false,
};

export const DEFAULT_CAPTION_PREFERENCES: CaptionPreferences = {
  enabled: false,
  source: "platform",
  preferredLanguage: null,
  localModelId: null,
  textSizePercent: 100,
  backgroundOpacityPercent: 80,
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "dark",
  language: "en",
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  chat: DEFAULT_CHAT_PREFERENCES,
  chatDisplay: DEFAULT_CHAT_DISPLAY_PREFERENCES,
  playback: DEFAULT_PLAYBACK_PREFERENCES,
  advanced: DEFAULT_ADVANCED_PREFERENCES,
  predictions: DEFAULT_PREDICTION_PREFERENCES,
  playerControls: DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  buffer: DEFAULT_BUFFER_PREFERENCES,
  proxy: DEFAULT_PROXY_PREFERENCES,
  twitchPlaylistProxy: DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
  playbackAdvanced: DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  captions: DEFAULT_CAPTION_PREFERENCES,
  startMinimized: false,
  minimizeToTray: true,
};

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1280,
  height: 720,
  isMaximized: false,
};
