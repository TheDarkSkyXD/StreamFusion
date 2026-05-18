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

export interface UserPreferences {
  theme: Theme;
  language: string;
  notifications: NotificationPreferences;
  chat: ChatPreferences;
  playback: PlaybackPreferences;
  advanced: AdvancedPreferences;
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

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "dark",
  language: "en",
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  chat: DEFAULT_CHAT_PREFERENCES,
  playback: DEFAULT_PLAYBACK_PREFERENCES,
  advanced: DEFAULT_ADVANCED_PREFERENCES,
  startMinimized: false,
  minimizeToTray: true,
};

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1280,
  height: 720,
  isMaximized: false,
};
