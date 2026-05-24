/**
 * Authentication Type Definitions
 *
 * Shared type definitions for authentication across main and renderer processes.
 */

// ========== Platform Types ==========

export type Platform = "twitch" | "kick";

// ========== Token Types ==========

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in milliseconds
  scope?: string[];
}

export interface EncryptedToken {
  encrypted: string; // Base64 encoded encrypted token
  iv?: string; // Initialization vector if needed
}

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
 * Origin of a local-follow row.
 *
 * - `account` rows come from the post-login `syncFollowsOnLogin` bulk import
 *   (Twitch `/channels/followed`, Kick equivalent) and are read-only in the
 *   renderer — UI surfaces redirect the user to the source platform to
 *   unfollow there. Owned by sync, which deletes and re-inserts them.
 * - `guest` rows are in-app follows added via the heart button while signed
 *   OUT of that platform.
 * - `local` rows are in-app follows added via the heart button while signed
 *   IN to that platform. They survive the background platform sync (which
 *   rewrites only `account` rows), are locally unfollowable (the heart toggles
 *   them off — no platform redirect), and are surfaced only while a token is
 *   present for that platform (hidden when signed out, reappear on re-login).
 */
export type FollowSource = "guest" | "account" | "local";

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
  /**
   * Set server-side when added via the FollowButton: "local" when signed in to
   * this row's platform, otherwise "guest". "account" is written only by sync.
   */
  source?: FollowSource;
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
export type VideoQuality = "auto" | "1080p" | "720p" | "480p" | "360p" | "160p";
export type ChatPosition = "right" | "left" | "hidden";
export type ChatSize = "small" | "medium" | "large";

export interface NotificationPreferences {
  enabled: boolean;
  liveAlerts: boolean;
  sound: boolean;
  favoriteChannelsOnly: boolean;
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

export type TimestampFormat = "HH:mm" | "h:mm a";
export type ChatDensity = "cozy" | "compact";

/**
 * Viewer-facing chat display preferences (Twitch + Kick unified renderer).
 *
 * Its own top-level group — distinct from the legacy `ChatPreferences`
 * (position/size) — so older installs hydrate the whole group with defaults
 * under the shallow top-level preferences merge. Appearance fields live-apply
 * to the renderer; emote-provider and event toggles apply on the next channel
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
  /** Docked chat panel width as a percentage of the stream area (Stream/MultiStream pages, U2). */
  chatWidthPct: number; // 0-100
  // Emotes & badges
  enable7tv: boolean;
  enableBttv: boolean;
  enableFfz: boolean;
  /** Play animated emotes vs. render a static frame. */
  animatedEmotes: boolean;
  /** Stack zero-width / overlay emotes on the previous emote. */
  overlayEmotes: boolean;
  /** Render emotes inside system / notice messages. */
  systemMessageEmotes: boolean;
  // Messages & events
  showUserNotices: boolean;
  showClearMsg: boolean;
  showClearChat: boolean;
  firstMsgHighlight: boolean;
  showPolls: boolean;
  showPredictions: boolean;
  recentMessagesOnJoin: boolean;
  recentMessagesLimit: number;
  /**
   * Max messages retained in the live buffer before the oldest are pruned.
   * Default 100 matches the shipped RAM-safe cap; the consumer clamps to <= 400
   * (raising it regresses the 5 GB-spike mitigation; the array is shared across
   * multiview panels). See plan U4.
   */
  messageLimit: number;
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
  startMinimized: boolean;
  minimizeToTray: boolean;
}

// ========== Storage Schema ==========

export interface StorageSchema {
  // Auth tokens (encrypted)
  authTokens: {
    twitch?: EncryptedToken;
    kick?: EncryptedToken;
  };

  // App tokens (encrypted, for client credentials flow)
  appTokens?: {
    twitch?: EncryptedToken;
    kick?: EncryptedToken;
  };

  // User data
  twitchUser: TwitchUser | null;
  kickUser: KickUser | null;

  // Local follows (for guest mode)
  localFollows: LocalFollow[];

  // User preferences
  preferences: UserPreferences;

  // App state
  lastActiveTab: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
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
  sound: true,
  favoriteChannelsOnly: false,
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

export const DEFAULT_ADVANCED_PREFERENCES: AdvancedPreferences = {
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

export const DEFAULT_CHAT_DISPLAY_PREFERENCES: ChatDisplayPreferences = {
  // Appearance
  boldUsernames: false,
  readableColorForUncolored: true,
  themeAdaptUsernameColor: true,
  timestamps: false,
  timestampFormat: "HH:mm",
  fontSizePx: 13,
  emoteSizePx: 28,
  density: "cozy",
  chatWidthPct: 30,
  // Emotes & badges
  enable7tv: true,
  enableBttv: true,
  enableFfz: true,
  animatedEmotes: true,
  overlayEmotes: true,
  systemMessageEmotes: true,
  // Messages & events
  showUserNotices: true,
  showClearMsg: true,
  showClearChat: true,
  firstMsgHighlight: true,
  showPolls: true,
  showPredictions: true,
  recentMessagesOnJoin: true,
  recentMessagesLimit: 100,
  messageLimit: 100,
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
  startMinimized: false,
  minimizeToTray: true,
};

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1280,
  height: 720,
  isMaximized: false,
};
