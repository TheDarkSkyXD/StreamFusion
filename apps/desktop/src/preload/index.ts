/**
 * Preload Script
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 *
 * Security: Only expose necessary functions, never expose ipcRenderer directly.
 */

import { contextBridge, ipcRenderer } from "electron";

import type {
  AuthToken,
  KickUser,
  LocalFollow,
  Platform,
  TwitchUser,
  UserPreferences,
} from "../shared/auth-types";
import { type AuthStatus, IPC_CHANNELS, type VersionInfo } from "../shared/ipc-channels";

// Define the API exposed to the renderer
const electronAPI = {
  // ========== App Info ==========
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  getVersionInfo: (): Promise<VersionInfo> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION_INFO),
  getName: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_NAME),

  // ========== Window Controls ==========
  minimizeWindow: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
      callback(isMaximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, handler);
  },

  // ========== Theme ==========
  getSystemTheme: (): Promise<"light" | "dark"> =>
    ipcRenderer.invoke(IPC_CHANNELS.THEME_GET_SYSTEM),

  // ========== Generic Storage (deprecated) ==========
  store: {
    get: <T>(key: string): Promise<T | null> => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET, { key }),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.STORE_SET, { key, value }),
    delete: (key: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.STORE_DELETE, { key }),
  },

  // ========== Auth - OAuth Flow ==========
  auth: {
    // Open OAuth login windows - throws if OAuth fails or is not configured
    openTwitchLogin: async (): Promise<void> => {
      const result = (await ipcRenderer.invoke(IPC_CHANNELS.AUTH_OPEN_TWITCH)) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) {
        throw new Error(result.error || "Twitch login failed");
      }
    },
    openKickLogin: async (): Promise<void> => {
      const result = (await ipcRenderer.invoke(IPC_CHANNELS.AUTH_OPEN_KICK)) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) {
        throw new Error(result.error || "Kick login failed");
      }
    },

    // Device Code Flow (Twitch) - for desktop apps without redirect URI
    startDeviceCodeFlow: async (): Promise<{
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      expiresIn: number;
      interval: number;
    }> => {
      const result = (await ipcRenderer.invoke(IPC_CHANNELS.AUTH_DCF_START)) as {
        success: boolean;
        error?: string;
        userCode?: string;
        verificationUri?: string;
        deviceCode?: string;
        expiresIn?: number;
        interval?: number;
      };
      if (!result.success) {
        throw new Error(result.error || "Failed to start device code flow");
      }
      return {
        userCode: result.userCode!,
        verificationUri: result.verificationUri!,
        deviceCode: result.deviceCode!,
        expiresIn: result.expiresIn!,
        interval: result.interval!,
      };
    },
    pollDeviceCode: async (
      deviceCode: string,
      interval: number,
      expiresIn: number
    ): Promise<void> => {
      const result = (await ipcRenderer.invoke(IPC_CHANNELS.AUTH_DCF_POLL, {
        deviceCode,
        interval,
        expiresIn,
      })) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || "Device code polling failed");
      }
    },
    cancelDeviceCodeFlow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_DCF_CANCEL),
    onDeviceCodeStatus: (
      callback: (data: { status: string; message?: string }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { status: string; message?: string }
      ) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUTH_DCF_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_DCF_STATUS, handler);
    },

    // Listen for OAuth callback
    onCallback: (
      callback: (data: { platform: string; success: boolean; error?: string }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { platform: string; success: boolean; error?: string }
      ) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUTH_ON_CALLBACK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_ON_CALLBACK, handler);
    },

    // Token management
    getToken: (platform: Platform): Promise<AuthToken | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_TOKEN, { platform }),
    saveToken: (platform: Platform, token: AuthToken): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SAVE_TOKEN, { platform, token }),
    clearToken: (platform: Platform): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLEAR_TOKEN, { platform }),
    hasToken: (platform: Platform): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_HAS_TOKEN, { platform }),
    isTokenExpired: (platform: Platform): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED, { platform }),
    clearAllTokens: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLEAR_ALL_TOKENS),

    // User data - Twitch
    getTwitchUser: (): Promise<TwitchUser | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_TWITCH_USER),
    saveTwitchUser: (user: TwitchUser): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SAVE_TWITCH_USER, { user }),
    clearTwitchUser: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLEAR_TWITCH_USER),

    // User data - Kick
    getKickUser: (): Promise<KickUser | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_KICK_USER),
    saveKickUser: (user: KickUser): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SAVE_KICK_USER, { user }),
    clearKickUser: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CLEAR_KICK_USER),

    // Twitch operations
    logoutTwitch: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT_TWITCH),
    refreshTwitchToken: (): Promise<{ success: boolean; token?: AuthToken; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_REFRESH_TWITCH),
    fetchTwitchUser: (): Promise<{ success: boolean; user?: TwitchUser; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_FETCH_TWITCH_USER),

    // Kick operations
    refreshKickToken: (): Promise<{ success: boolean; token?: AuthToken; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_REFRESH_KICK),
    logoutKick: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT_KICK),
    fetchKickUser: (): Promise<{ success: boolean; user?: KickUser; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_FETCH_KICK_USER),

    // Listen for Kick session expiry pushed from the main process
    onKickSessionExpired: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED, handler);
    },

    // Auth status
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATUS),
  },

  // ========== Local Follows ==========
  follows: {
    getAll: (): Promise<LocalFollow[]> => ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_GET_ALL),
    getByPlatform: (platform: Platform): Promise<LocalFollow[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM, { platform }),
    add: (follow: Omit<LocalFollow, "id" | "followedAt">): Promise<LocalFollow> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_ADD, { follow }),
    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_REMOVE, { id }),
    update: (id: string, updates: Partial<LocalFollow>): Promise<LocalFollow | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_UPDATE, { id, updates }),
    isFollowing: (platform: Platform, channelId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_IS_FOLLOWING, { platform, channelId }),
    import: (follows: LocalFollow[]): Promise<number> =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_IMPORT, { follows }),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.FOLLOWS_CLEAR),
  },

  // ========== User Preferences ==========
  preferences: {
    get: (): Promise<UserPreferences> => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_GET),
    update: (updates: Partial<UserPreferences>): Promise<UserPreferences> =>
      ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_UPDATE, { updates }),
    reset: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_RESET),
  },

  // ========== External Links ==========
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, { url }),

  // ========== Notifications ==========
  showNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SHOW, { title, body }),

  // ========== Image Proxy (CORS bypass) ==========
  proxyImage: (url: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.IMAGE_PROXY, { url }),

  // ========== Discovery: Streams ==========
  streams: {
    getTop: (params?: {
      platform?: Platform;
      categoryId?: string;
      language?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ success: boolean; data?: any[]; cursor?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_TOP, params || {}),

    getByCategory: (params: {
      categoryId: string;
      platform?: Platform;
      limit?: number;
      cursor?: string;
    }): Promise<{ success: boolean; data?: any[]; cursor?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY, params),

    getFollowed: (params?: {
      platform?: Platform;
      limit?: number;
      cursor?: string;
    }): Promise<{ success: boolean; data?: any[]; cursor?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_FOLLOWED, params || {}),

    getByChannel: (params: {
      platform: Platform;
      username: string;
    }): Promise<{ success: boolean; data?: any; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      channelSlug: string;
    }): Promise<{ success: boolean; data?: { url: string; format: string }; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL, params),
  },

  // ========== Discovery: Categories ==========
  categories: {
    getTop: (params?: {
      platform?: Platform;
      limit?: number;
      cursor?: string;
    }): Promise<{ success: boolean; data?: any[]; cursor?: string; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_GET_TOP, params || {}),

    getById: (params: {
      platform: Platform;
      categoryId: string;
    }): Promise<{ success: boolean; data?: any; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_GET_BY_ID, params),

    search: (params: {
      query: string;
      platform?: Platform;
      limit?: number;
    }): Promise<{ success: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORIES_SEARCH, params),
  },

  // ========== Discovery: Search ==========
  search: {
    channels: (params: {
      query: string;
      platform?: Platform;
      liveOnly?: boolean;
      limit?: number;
    }): Promise<{ success: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_CHANNELS, params),

    all: (params: {
      query: string;
      platform?: Platform;
      limit?: number;
    }): Promise<{
      success: boolean;
      data?: { channels: any[]; categories: any[]; streams: any[] };
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_ALL, params),
  },

  // ========== Discovery: Channels ==========
  channels: {
    getById: (params: {
      platform: Platform;
      channelId: string;
    }): Promise<{ success: boolean; data?: any; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHANNELS_GET_BY_ID, params),

    getByUsername: (params: {
      platform: Platform;
      username: string;
    }): Promise<{ success: boolean; data?: any; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME, params),

    getFollowed: (params: {
      platform: Platform;
    }): Promise<{ success: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHANNELS_GET_FOLLOWED, params),
  },

  // ========== Discovery: Videos & Clips ==========
  videos: {
    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{
      success: boolean;
      data?: any[];
      cursor?: string;
      debug?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      videoId: string;
    }): Promise<{ success: boolean; data?: { url: string }; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL, params),

    getMetadata: (params: {
      platform: Platform;
      videoId: string;
    }): Promise<{
      success: boolean;
      data?: {
        id: string;
        title: string;
        channelId: string;
        channelName: string;
        channelDisplayName: string;
        channelAvatar: string | null;
        views: number;
        duration: string;
        createdAt: string;
        thumbnailUrl: string;
        description: string;
        type: string;
        platform: string;
      };
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.VIDEOS_GET_METADATA, params),

    // Look up Kick VOD by livestream ID (for clip-to-VOD navigation)
    getByLivestreamId: (params: {
      channelSlug: string;
      livestreamId: string;
    }): Promise<{
      success: boolean;
      data?: {
        id: string;
        title: string;
        source: string;
        thumbnailUrl: string;
        duration: string;
        views: string;
        date: string;
        channelSlug: string;
        channelName: string;
        category: string;
      };
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID, params),
  },

  clips: {
    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
      sort?: "date" | "views";
      timeRange?: "day" | "week" | "month" | "all";
    }): Promise<{
      success: boolean;
      data?: any[];
      cursor?: string;
      debug?: string;
      error?: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.CLIPS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      clipId: string;
      thumbnailUrl?: string;
      clipUrl?: string;
    }): Promise<{ success: boolean; data?: { url: string; format: string }; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL, params),
  },

  // ========== Ad Blocking ==========
  adblock: {
    getStatus: (): Promise<{
      networkBlockingEnabled: boolean;
      cosmeticFilteringEnabled: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_GET_STATUS),
    toggle: (options: {
      network?: boolean;
      cosmetic?: boolean;
    }): Promise<{ networkBlockingEnabled: boolean; cosmeticFilteringEnabled: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_TOGGLE, options),
    getStats: (): Promise<{
      totalBlocked: number;
      byCategory: Record<string, number>;
      recentBlocked: string[];
    }> => ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_GET_STATS),
    injectCosmetics: (): Promise<{ injected: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_INJECT_COSMETICS),
    // Stream proxy cleanup - prevents memory leaks
    clearProxyStreamInfo: (channelName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_STREAM, { channelName }),
    clearAllProxyStreamInfos: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_ALL),
    // VAFT pattern management
    getPatterns: (): Promise<{
      version: number;
      adSignifiers: string[];
      dateRangePatterns: string[];
      backupPlayerTypes: string[];
      lastUpdated: string;
    }> => ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PATTERNS_GET),
    refreshPatterns: (): Promise<{ success: boolean; patterns: unknown }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH),
    getPatternStats: (): Promise<{
      version: number;
      dateRangePatternCount: number;
      signifierCount: number;
      backupPlayerTypeCount: number;
      lastChecked: string;
      autoUpdateEnabled: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PATTERNS_GET_STATS),
    setPatternAutoUpdate: (enabled: boolean): Promise<{ autoUpdateEnabled: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ADBLOCK_PATTERNS_SET_AUTO_UPDATE, { enabled }),
  },

  // ========== App Auto-Update ==========
  updater: {
    check: (): Promise<{
      status: string;
      updateInfo: {
        version: string;
        releaseDate: string;
        releaseNotes: string | null;
        releaseName: string | null;
      } | null;
      error: string | null;
      allowPrerelease: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),

    download: (): Promise<{
      status: string;
      updateInfo: {
        version: string;
        releaseDate: string;
        releaseNotes: string | null;
        releaseName: string | null;
      } | null;
      progress: {
        bytesPerSecond: number;
        percent: number;
        transferred: number;
        total: number;
      } | null;
      error: string | null;
    }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),

    install: (): Promise<{ success: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),

    getStatus: (): Promise<{
      status: string;
      updateInfo: {
        version: string;
        releaseDate: string;
        releaseNotes: string | null;
        releaseName: string | null;
      } | null;
      progress: {
        bytesPerSecond: number;
        percent: number;
        transferred: number;
        total: number;
      } | null;
      error: string | null;
      allowPrerelease: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_STATUS),

    setAllowPrerelease: (
      allow: boolean
    ): Promise<{
      status: string;
      allowPrerelease: boolean;
    }> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE, { allow }),

    getSettings: (): Promise<{ allowPrerelease: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_SETTINGS),

    onStatusChange: (
      callback: (state: {
        status: string;
        updateInfo: {
          version: string;
          releaseDate: string;
          releaseNotes: string | null;
          releaseName: string | null;
        } | null;
        progress: {
          bytesPerSecond: number;
          percent: number;
          transferred: number;
          total: number;
        } | null;
        error: string | null;
        allowPrerelease: boolean;
      }) => void
    ): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) =>
        callback(state as Parameters<typeof callback>[0]);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ON_STATUS_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ON_STATUS_CHANGE, handler);
    },

    onProgress: (
      callback: (progress: {
        bytesPerSecond: number;
        percent: number;
        transferred: number;
        total: number;
      }) => void
    ): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress as Parameters<typeof callback>[0]);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ON_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ON_PROGRESS, handler);
    },
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI;
