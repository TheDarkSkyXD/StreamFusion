/**
 * Preload Script
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 *
 * Security: Only expose necessary functions, never expose ipcRenderer directly.
 */

import { contextBridge, ipcRenderer } from "electron";

import { createFeatureAwareIpc } from "./ipc-feature-loader";

import type {
  KickPinMutationResult,
  KickPinPayload,
} from "../backend/api/platforms/kick/kick-pin-mutations";
import type {
  KickChannelViewerRoleResult,
  KickSendResult,
  KickWebApiMutationResult,
} from "../backend/api/platforms/kick/kick-send-window";
import type {
  PlatformHealth,
  PlatformHealthEvent,
  StatusPageDetail,
} from "../backend/api/unified/platform-health";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedStream,
} from "../backend/api/unified/platform-types";
import type {
  UserProfileChannel,
  UserProfileRequest,
  UserProfileResponse,
} from "../ipc-contracts/user-profile-contracts";
import type { EmoteIpcResponse, FfzRoomRequest } from "../ipc-contracts/emote-contracts";
import type { SearchResultCollection } from "../search/search-result-validation";
import type {
  AccountFollowWriteRequest,
  AccountFollowWriteResult,
  AuthToken,
  KickAccountFollowWriteSnapshot,
  KickAccountFollowWriteChangedEvent,
  KickUser,
  LiveNotificationCoverageStatus,
  LiveNotificationPayload,
  LocalFollow,
  Platform,
  TwitchUser,
  UserPreferences,
} from "../shared/auth-types";
import type {
  SubscriberEligibilityRequest,
  SubscriberEligibilityResult,
  TwitchBadgeCatalog,
} from "../shared/chat-types";
import type {
  CancelChatReplayWindowRequest,
  CancelChatReplayWindowResult,
  ChatReplayIpcWindowRequest,
  ChatReplayIpcWindowResult,
} from "../shared/chat-replay-types";
import type {
  CategoryClipsRequest,
  CategoryMediaResult,
  CategoryVideosRequest,
} from "../shared/category-media-types";
import type {
  ClipDownloadRequest,
  DownloadJob,
  DownloadQueueSnapshot,
  VideoDownloadRequest,
} from "../shared/download-types";
import type { DiscoveryResult } from "../shared/discovery-types";
import {
  type AppEnvironment,
  type AuthStatus,
  type AuthSyncFollowsResult,
  type BugReportResult,
  type CheckFrequency,
  type ConnectivityCheckResult,
  type IpcResult,
  IPC_CHANNELS,
  IPC_FEATURES,
  type PaginatedIpcResult,
  type ProxyApplyConfig,
  type ProxyApplyResult,
  type ProxyCredentialsInput,
  type TokenStatusResult,
  type UpdateProgress,
  type UpdateState,
  type VersionInfo,
} from "../shared/ipc-channels";
import type {
  LocalCaptionActionResult,
  LocalCaptionAudioPushResult,
  LocalCaptionModelActionResult,
  LocalCaptionModelState,
  LocalCaptionPcmChunk,
  LocalCaptionRecognizerState,
  LocalCaptionResult,
} from "../shared/local-caption-types";
import type {
  ModerationHistoryResult,
  ModLogInsertResult,
  ModLogQueryFilters,
  ModLogWriteEntry,
  RetentionScope,
} from "../shared/mod-log-types";
import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotPresence,
  SlotQualityConfig,
  SlotQualityMode,
} from "../shared/slot-types";
import type {
  TimeoutActionBinding,
  TimeoutSnapshotResult,
  TimeoutSubmitInput,
  TimeoutSubmitResult,
} from "../shared/timeout-moderation-types";
import type {
  StreamRecordingActionResult,
  StreamRecordingRecoveryActionResult,
  StreamRecordingRequest,
  StreamRecordingSnapshot,
  StreamRecordingStartResult,
} from "../shared/stream-recording-types";
import type { TwitchApiCommand, TwitchApiResult } from "../shared/twitch-api-types";

const featureAwareIpc = createFeatureAwareIpc(
  ipcRenderer.invoke.bind(ipcRenderer),
  ipcRenderer.send.bind(ipcRenderer)
);
const invokeIpc = featureAwareIpc.invoke;
const sendIpc = featureAwareIpc.send;

const UPDATE_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUpdateProgress(value: unknown): value is UpdateProgress {
  return (
    isRecord(value) &&
    isFiniteNumber(value.bytesPerSecond) &&
    isFiniteNumber(value.percent) &&
    isFiniteNumber(value.transferred) &&
    isFiniteNumber(value.total)
  );
}

function isUpdateInfo(value: unknown): value is NonNullable<UpdateState["updateInfo"]> {
  return (
    isRecord(value) &&
    typeof value.version === "string" &&
    typeof value.releaseDate === "string" &&
    (value.releaseNotes === null || typeof value.releaseNotes === "string") &&
    (value.releaseName === null || typeof value.releaseName === "string")
  );
}

function isUpdateState(value: unknown): value is UpdateState {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    UPDATE_STATUSES.has(value.status) &&
    (value.updateInfo === null || isUpdateInfo(value.updateInfo)) &&
    (value.progress === null || isUpdateProgress(value.progress)) &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.allowPrerelease === "boolean" &&
    typeof value.autoCheckEnabled === "boolean" &&
    (value.checkFrequency === "hourly" ||
      value.checkFrequency === "daily" ||
      value.checkFrequency === "weekly")
  );
}

function invokeUserProfile<Channel extends UserProfileChannel>(
  channel: Channel,
  request: UserProfileRequest<Channel>
): Promise<UserProfileResponse<Channel>> {
  return invokeIpc(channel, request);
}

// Define the API exposed to the renderer
const electronAPI = {
  // ========== App Info ==========
  getVersion: (): Promise<string> => invokeIpc(IPC_CHANNELS.APP_GET_VERSION),
  getVersionInfo: (): Promise<VersionInfo> => invokeIpc(IPC_CHANNELS.APP_GET_VERSION_INFO),
  getName: (): Promise<string> => invokeIpc(IPC_CHANNELS.APP_GET_NAME),

  // ========== Internet Connectivity ==========
  connectivity: {
    check: (): Promise<ConnectivityCheckResult> => invokeIpc(IPC_CHANNELS.CONNECTIVITY_CHECK),
  },

  // ========== Window Controls ==========
  minimizeWindow: (): void => sendIpc(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: (): void => sendIpc(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: (): void => sendIpc(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: (): Promise<boolean> => invokeIpc(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  toggleDevTools: (): void => sendIpc(IPC_CHANNELS.WINDOW_TOGGLE_DEV_TOOLS),
  onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
      callback(isMaximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, handler);
  },

  // ========== App Shutdown ==========
  /**
   * Subscribe to the main-process `before-quit` push. The renderer should
   * tear down expensive resources (chat sockets, batching timers) ASAP, then
   * acknowledge through closeWindow so main doesn't wait on its three-second
   * unresponsive-renderer fallback.
   */
  onBeforeQuit: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.APP_BEFORE_QUIT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_BEFORE_QUIT, handler);
  },

  // ========== Theme ==========
  getSystemTheme: (): Promise<"light" | "dark"> => invokeIpc(IPC_CHANNELS.THEME_GET_SYSTEM),

  // ========== Generic Storage (deprecated) ==========
  store: {
    get: (key: string): Promise<unknown> => invokeIpc(IPC_CHANNELS.STORE_GET, { key }),
    set: (key: string, value: unknown): Promise<void> =>
      invokeIpc(IPC_CHANNELS.STORE_SET, { key, value }),
    delete: (key: string): Promise<void> => invokeIpc(IPC_CHANNELS.STORE_DELETE, { key }),
  },

  // ========== Auth - OAuth Flow ==========
  auth: {
    // Open OAuth login windows - throws if OAuth fails or is not configured
    openTwitchLogin: async (): Promise<void> => {
      const result = (await invokeIpc(IPC_CHANNELS.AUTH_OPEN_TWITCH)) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) {
        throw new Error(result.error || "Twitch login failed");
      }
    },
    openKickLogin: async (): Promise<void> => {
      const result = (await invokeIpc(IPC_CHANNELS.AUTH_OPEN_KICK)) as {
        success: boolean;
        error?: string;
      };
      if (!result.success) {
        throw new Error(result.error || "Kick login failed");
      }
    },

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
    getToken: (platform: "kick"): Promise<AuthToken | null> =>
      invokeIpc(IPC_CHANNELS.AUTH_GET_TOKEN, { platform }),
    saveToken: (platform: "kick", token: AuthToken): Promise<void> =>
      invokeIpc(IPC_CHANNELS.AUTH_SAVE_TOKEN, { platform, token }),
    clearToken: (platform: Platform): Promise<void> =>
      invokeIpc(IPC_CHANNELS.AUTH_CLEAR_TOKEN, { platform }),
    hasToken: (platform: Platform): Promise<boolean> =>
      invokeIpc(IPC_CHANNELS.AUTH_HAS_TOKEN, { platform }),
    isTokenExpired: (platform: Platform): Promise<boolean> =>
      invokeIpc(IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED, { platform }),
    clearAllTokens: (): Promise<void> => invokeIpc(IPC_CHANNELS.AUTH_CLEAR_ALL_TOKENS),

    // User data - Twitch
    getTwitchUser: (): Promise<TwitchUser | null> => invokeIpc(IPC_CHANNELS.AUTH_GET_TWITCH_USER),
    saveTwitchUser: (user: TwitchUser): Promise<void> =>
      invokeIpc(IPC_CHANNELS.AUTH_SAVE_TWITCH_USER, { user }),
    clearTwitchUser: (): Promise<void> => invokeIpc(IPC_CHANNELS.AUTH_CLEAR_TWITCH_USER),

    // User data - Kick
    getKickUser: (): Promise<KickUser | null> => invokeIpc(IPC_CHANNELS.AUTH_GET_KICK_USER),
    saveKickUser: (user: KickUser): Promise<void> =>
      invokeIpc(IPC_CHANNELS.AUTH_SAVE_KICK_USER, { user }),
    clearKickUser: (): Promise<void> => invokeIpc(IPC_CHANNELS.AUTH_CLEAR_KICK_USER),

    // Twitch operations
    logoutTwitch: (): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.AUTH_LOGOUT_TWITCH),
    refreshTwitchToken: (): Promise<import("../shared/ipc-channels").TwitchAuthRefreshResult> =>
      invokeIpc(IPC_CHANNELS.AUTH_REFRESH_TWITCH),
    getValidTwitchToken: (): Promise<string | null> =>
      invokeIpc(IPC_CHANNELS.AUTH_GET_VALID_TWITCH_TOKEN),

    // Fired from the main process when the Twitch refresh chain dies
    // permanently (Twitch revoked the refresh token, or we hit the
    // transient-failure backoff cap). The auth-store subscribes and
    // surfaces a "Reconnect Twitch" error so the user can re-authenticate.
    onTwitchAuthLost: (callback: () => void): (() => void) => {
      const handler = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.AUTH_TWITCH_AUTH_LOST, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC_CHANNELS.AUTH_TWITCH_AUTH_LOST, handler);
      };
    },
    fetchTwitchUser: (): Promise<{ success: boolean; user?: TwitchUser; error?: string }> =>
      invokeIpc(IPC_CHANNELS.AUTH_FETCH_TWITCH_USER),

    // Kick operations
    refreshKickToken: (): Promise<{ success: boolean; token?: AuthToken; error?: string }> =>
      invokeIpc(IPC_CHANNELS.AUTH_REFRESH_KICK),
    logoutKick: (): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.AUTH_LOGOUT_KICK),
    fetchKickUser: (): Promise<{ success: boolean; user?: KickUser; error?: string }> =>
      invokeIpc(IPC_CHANNELS.AUTH_FETCH_KICK_USER),
    syncFollows: (platform: Platform): Promise<AuthSyncFollowsResult> =>
      invokeIpc(IPC_CHANNELS.AUTH_SYNC_FOLLOWS, { platform }),
    // Listen for Kick session expiry pushed from the main process
    onKickSessionExpired: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED, handler);
    },

    // Listen for the main process finishing the post-login account-follows
    // sync. Renderer re-hydrates useFollowStore + invalidates the followed
    // React-Query caches so the sidebar and FollowButton flip to "Following"
    // without waiting for a manual refresh.
    onFollowsSynced: (
      callback: (data: {
        platform: Platform;
        count: number;
        pendingCount?: number;
        addedCount?: number;
        removedCount?: number;
      }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          platform: Platform;
          count: number;
          pendingCount?: number;
          addedCount?: number;
          removedCount?: number;
        }
      ) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUTH_FOLLOWS_SYNCED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_FOLLOWS_SYNCED, handler);
    },

    // Auth status
    getStatus: (): Promise<AuthStatus> => invokeIpc(IPC_CHANNELS.AUTH_GET_STATUS),

    // Read-only token status for the Settings → API / Tokens panel (U14).
    // Validates the stored token live and returns identity/validity/expiry/
    // scopes ONLY — never a token value (enforced by TokenStatusResult).
    tokenStatus: (platform: Platform): Promise<TokenStatusResult> =>
      invokeIpc(IPC_CHANNELS.AUTH_TOKEN_STATUS, { platform }),
  },

  // ========== Twitch API (main-owned credentials + transport) ==========
  twitch: {
    execute: (command: TwitchApiCommand): Promise<TwitchApiResult> =>
      invokeIpc(IPC_CHANNELS.TWITCH_API_EXECUTE, command),
    eventSub: {
      start: (params: {
        feedId: string;
        userId: string;
        channelId: string;
      }): Promise<TwitchApiResult> => invokeIpc(IPC_CHANNELS.TWITCH_EVENTSUB_START, params),
      stop: (feedId: string): Promise<boolean> =>
        invokeIpc(IPC_CHANNELS.TWITCH_EVENTSUB_STOP, { feedId }),
      onEvent: (callback: (event: { feedId: string; payload: unknown }) => void): (() => void) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          payload: { feedId: string; payload: unknown }
        ) => callback(payload);
        ipcRenderer.on(IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, handler);
      },
      onState: (callback: (event: { feedId: string; state: string }) => void): (() => void) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          payload: { feedId: string; state: string }
        ) => callback(payload);
        ipcRenderer.on(IPC_CHANNELS.TWITCH_EVENTSUB_STATE, handler);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TWITCH_EVENTSUB_STATE, handler);
      },
    },
  },

  // ========== Local Follows ==========
  follows: {
    getAll: (): Promise<LocalFollow[]> => invokeIpc(IPC_CHANNELS.FOLLOWS_GET_ALL),
    getByPlatform: (platform: Platform): Promise<LocalFollow[]> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM, { platform }),
    add: (follow: Omit<LocalFollow, "id" | "followedAt">): Promise<LocalFollow> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_ADD, { follow }),
    remove: (id: string): Promise<boolean> => invokeIpc(IPC_CHANNELS.FOLLOWS_REMOVE, { id }),
    update: (id: string, updates: Partial<LocalFollow>): Promise<LocalFollow | null> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_UPDATE, { id, updates }),
    isFollowing: (platform: Platform, channelId: string): Promise<boolean> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_IS_FOLLOWING, { platform, channelId }),
    import: (follows: LocalFollow[]): Promise<number> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_IMPORT, { follows }),
    clear: (): Promise<void> => invokeIpc(IPC_CHANNELS.FOLLOWS_CLEAR),
    getAccountWrites: (): Promise<KickAccountFollowWriteSnapshot[]> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_GET_ACCOUNT_WRITES),
    writeAccount: (request: AccountFollowWriteRequest): Promise<AccountFollowWriteResult> =>
      invokeIpc(IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT, request),
    onAccountWriteChanged: (
      callback: (event: KickAccountFollowWriteChangedEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: KickAccountFollowWriteChangedEvent
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, handler);
    },
  },

  // ========== User Preferences ==========
  preferences: {
    get: (): Promise<UserPreferences> => invokeIpc(IPC_CHANNELS.PREFERENCES_GET),
    update: (updates: Partial<UserPreferences>): Promise<UserPreferences> =>
      invokeIpc(IPC_CHANNELS.PREFERENCES_UPDATE, { updates }),
    reset: (): Promise<void> => invokeIpc(IPC_CHANNELS.PREFERENCES_RESET),
  },

  // ========== Outbound Stream Proxy (Xtra port U11) ==========
  proxy: {
    /**
     * Apply (or clear) the outbound proxy on the window session. Pass
     * host/port/enabled only — credentials go via `setCredentials` and never
     * leave main. Returns what main actually did (applied / cleared / error).
     */
    apply: (config: ProxyApplyConfig): Promise<ProxyApplyResult> =>
      invokeIpc(IPC_CHANNELS.PROXY_APPLY, { config }),
    /**
     * Store (or clear with `null`) the proxy credentials. Write-only: the
     * password is encrypted in main and is never returned by any channel.
     */
    setCredentials: (
      credentials: ProxyCredentialsInput | null
    ): Promise<{ hasCredentials: boolean }> =>
      invokeIpc(IPC_CHANNELS.PROXY_SET_CREDENTIALS, { credentials }),
    /** Advisory: whether encrypted credentials are stored (never the values). */
    hasCredentials: (): Promise<{ hasCredentials: boolean }> =>
      invokeIpc(IPC_CHANNELS.PROXY_HAS_CREDENTIALS),
  },

  // ========== External Links ==========
  openExternal: (url: string): Promise<void> =>
    invokeIpc(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, { url }),

  // ========== Notifications ==========
  showNotification: (title: string, body: string): Promise<void> =>
    invokeIpc(IPC_CHANNELS.NOTIFICATION_SHOW, { title, body }),
  notifications: {
    getCoverageStatus: (): Promise<LiveNotificationCoverageStatus> =>
      invokeIpc(IPC_CHANNELS.NOTIFICATION_COVERAGE_GET),
    onLiveNotification: (
      callback: (notification: LiveNotificationPayload) => void
    ): (() => void) => {
      void featureAwareIpc.loadFeature(IPC_FEATURES.NOTIFICATIONS);
      const handler = (_event: Electron.IpcRendererEvent, notification: LiveNotificationPayload) =>
        callback(notification);
      ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_LIVE_RECEIVED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_LIVE_RECEIVED, handler);
    },
    onOpenLiveNotification: (
      callback: (notification: LiveNotificationPayload) => void
    ): (() => void) => {
      void featureAwareIpc.loadFeature(IPC_FEATURES.NOTIFICATIONS);
      const handler = (_event: Electron.IpcRendererEvent, notification: LiveNotificationPayload) =>
        callback(notification);
      ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_OPEN_STREAM, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_OPEN_STREAM, handler);
    },
  },

  // ========== Discovery: Streams ==========
  streams: {
    getTop: (params?: {
      platform?: Platform;
      categoryId?: string;
      language?: string;
      limit?: number;
      cursor?: string;
    }): Promise<PaginatedIpcResult<UnifiedStream[]>> =>
      invokeIpc(IPC_CHANNELS.STREAMS_GET_TOP, params || {}),

    getByCategory: (params: {
      categoryId: string;
      platform?: Platform;
      limit?: number;
      cursor?: string;
      categoryName?: string;
      language?: string;
    }): Promise<PaginatedIpcResult<UnifiedStream[]>> =>
      invokeIpc(IPC_CHANNELS.STREAMS_GET_BY_CATEGORY, params),

    getFollowed: (params?: {
      platform?: Platform;
      limit?: number;
      cursor?: string;
    }): Promise<PaginatedIpcResult<UnifiedStream[]>> =>
      invokeIpc(IPC_CHANNELS.STREAMS_GET_FOLLOWED, params || {}),

    getByChannel: (params: {
      platform: Platform;
      username: string;
    }): Promise<IpcResult<UnifiedStream | null>> =>
      invokeIpc(IPC_CHANNELS.STREAMS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      channelSlug: string;
    }): Promise<IpcResult<{ url: string; format: string }>> =>
      invokeIpc(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL, params),
  },

  // ========== Discovery: Categories ==========
  categories: {
    getTop: (params?: {
      platform?: Platform;
      limit?: number;
      cursor?: string;
    }): Promise<DiscoveryResult<UnifiedCategory[]>> =>
      invokeIpc(IPC_CHANNELS.CATEGORIES_GET_TOP, params || {}),

    getById: (params: {
      platform: Platform;
      categoryId: string;
    }): Promise<IpcResult<UnifiedCategory | null>> =>
      invokeIpc(IPC_CHANNELS.CATEGORIES_GET_BY_ID, params),

    search: (params: {
      query: string;
      platform?: Platform;
      limit?: number;
      after?: string;
    }): Promise<DiscoveryResult<UnifiedCategory[]>> =>
      invokeIpc(IPC_CHANNELS.CATEGORIES_SEARCH, params),

    getMetadata: (params: {
      platform: Platform;
      categoryId: string;
      slug?: string;
    }): Promise<{
      success: boolean;
      data?: { tags?: string[]; streamCount: number; streamCountExact: boolean };
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.CATEGORIES_GET_METADATA, params),
  },

  // ========== Discovery: Search ==========
  search: {
    channels: (params: {
      query: string;
      platform?: Platform;
      liveOnly?: boolean;
      limit?: number;
      after?: string;
    }): Promise<PaginatedIpcResult<UnifiedChannel[]>> =>
      invokeIpc(IPC_CHANNELS.SEARCH_CHANNELS, params),

    all: (params: {
      query: string;
      platform?: Platform;
      limit?: number;
      channelSeeds?: UnifiedChannel[];
      channelSeedPlatforms?: Platform[];
      requestId?: string;
    }): Promise<DiscoveryResult<SearchResultCollection>> =>
      invokeIpc(IPC_CHANNELS.SEARCH_ALL, params),

    cancel: (params: { requestId: string }): Promise<{ success: boolean; cancelled: boolean }> =>
      invokeIpc(IPC_CHANNELS.SEARCH_CANCEL, params),
  },

  // ========== Discovery: Channels ==========
  channels: {
    getById: (params: {
      platform: Platform;
      channelId: string;
    }): Promise<IpcResult<UnifiedChannel | null>> =>
      invokeIpc(IPC_CHANNELS.CHANNELS_GET_BY_ID, params),

    getByUsername: (params: {
      platform: Platform;
      username: string;
      freshChatroomSettings?: boolean;
    }): Promise<IpcResult<UnifiedChannel | null>> =>
      invokeIpc(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME, params),

    getFollowed: (params: { platform: Platform }): Promise<IpcResult<UnifiedChannel[]>> =>
      invokeIpc(IPC_CHANNELS.CHANNELS_GET_FOLLOWED, params),
  },

  userProfiles: {
    getTwitchIdentity: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY, request),
    getTwitchAccountCreated: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED, request),
    getTwitchFollow: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW, request),
    resolveTwitchChannel: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL, request),
    getKickIdentity: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY, request),
    getKickAccountCreated: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED, request),
    getKickFollow: (request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW>) =>
      invokeUserProfile(IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW, request),
    resolveKickChannel: (
      request: UserProfileRequest<typeof IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL>
    ) => invokeUserProfile(IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL, request),
  },

  // ========== Discovery: Videos & Clips ==========
  videos: {
    getByCategory: (request: CategoryVideosRequest): Promise<CategoryMediaResult> =>
      invokeIpc(IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY, request),

    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
      sort?: "date" | "views";
    }): Promise<PaginatedIpcResult<unknown[]>> =>
      invokeIpc(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      videoId: string;
    }): Promise<IpcResult<{ url: string }>> =>
      invokeIpc(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL, params),

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
        shareUrl?: string;
      };
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.VIDEOS_GET_METADATA, params),

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
        shareUrl?: string;
      };
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID, params),

    getChatReplayWindow: (
      request: ChatReplayIpcWindowRequest
    ): Promise<ChatReplayIpcWindowResult> =>
      invokeIpc(IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW, request),

    cancelChatReplayWindow: (
      request: CancelChatReplayWindowRequest
    ): Promise<CancelChatReplayWindowResult> =>
      invokeIpc(IPC_CHANNELS.VIDEOS_CANCEL_CHAT_REPLAY_WINDOW, request),
  },

  clips: {
    getByCategory: (request: CategoryClipsRequest): Promise<CategoryMediaResult> =>
      invokeIpc(IPC_CHANNELS.CLIPS_GET_BY_CATEGORY, request),

    getByChannel: (params: {
      platform: Platform;
      channelName: string;
      channelId?: string;
      limit?: number;
      cursor?: string;
      sort?: "date" | "views";
      timeRange?: "day" | "week" | "month" | "all";
    }): Promise<PaginatedIpcResult<unknown[]>> =>
      invokeIpc(IPC_CHANNELS.CLIPS_GET_BY_CHANNEL, params),

    getPlaybackUrl: (params: {
      platform: Platform;
      clipId: string;
      thumbnailUrl?: string;
      clipUrl?: string;
    }): Promise<IpcResult<{ url: string; format: string }>> =>
      invokeIpc(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL, params),
  },

  // ========== Downloads ==========
  downloads: {
    getQueue: (): Promise<DownloadQueueSnapshot> => invokeIpc(IPC_CHANNELS.DOWNLOADS_GET_QUEUE),
    downloadClip: (
      request: ClipDownloadRequest
    ): Promise<{ success: boolean; jobId?: string; cancelled?: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP, request),
    downloadVideo: (
      request: VideoDownloadRequest
    ): Promise<{ success: boolean; jobId?: string; cancelled?: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO, request),
    pause: (id: string): Promise<{ success: boolean; job?: DownloadJob; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_PAUSE, { id }),
    resume: (id: string): Promise<{ success: boolean; job?: DownloadJob; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_RESUME, { id }),
    cancel: (id: string): Promise<{ success: boolean; job?: DownloadJob; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_CANCEL, { id }),
    retry: (id: string): Promise<{ success: boolean; job?: DownloadJob; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_RETRY, { id }),
    remove: (id: string): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_REMOVE, { id }),
    showInFolder: (id: string): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, { id }),
    openFile: (id: string): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, { id }),
    deleteFile: (id: string): Promise<{ success: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.DOWNLOADS_DELETE_FILE, { id }),
    onQueueChanged: (callback: (snapshot: DownloadQueueSnapshot) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: DownloadQueueSnapshot) =>
        callback(snapshot);
      ipcRenderer.on(IPC_CHANNELS.DOWNLOADS_QUEUE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOADS_QUEUE_CHANGED, handler);
    },
  },

  // ========== Stream Recording ==========
  streamRecording: {
    getState: (): Promise<StreamRecordingSnapshot> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_GET_STATE),
    start: (request: StreamRecordingRequest): Promise<StreamRecordingStartResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_START, request),
    stop: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_STOP, { sessionId }),
    discard: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_DISCARD, { sessionId }),
    pause: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_PAUSE, { sessionId }),
    resume: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_RESUME, { sessionId }),
    resumeInterrupted: (sessionId: string): Promise<StreamRecordingRecoveryActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_RESUME_INTERRUPTED, { sessionId }),
    finalizeInterrupted: (sessionId: string): Promise<StreamRecordingRecoveryActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_FINALIZE_INTERRUPTED, { sessionId }),
    dismissInterrupted: (
      sessionId: string,
      confirmed: boolean
    ): Promise<StreamRecordingRecoveryActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_DISMISS_INTERRUPTED, {
        sessionId,
        confirmed,
      }),
    openCompleted: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_OPEN_COMPLETED, { sessionId }),
    showCompleted: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_SHOW_COMPLETED, { sessionId }),
    dismissNotice: (sessionId: string): Promise<StreamRecordingActionResult> =>
      invokeIpc(IPC_CHANNELS.STREAM_RECORDING_DISMISS_NOTICE, { sessionId }),
    onStateChanged: (callback: (snapshot: StreamRecordingSnapshot) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: StreamRecordingSnapshot) =>
        callback(snapshot);
      ipcRenderer.on(IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.STREAM_RECORDING_STATE_CHANGED, handler);
    },
  },

  // ========== Local Captions ==========
  localCaptions: {
    getModelState: (): Promise<LocalCaptionModelState> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_GET_STATE),
    downloadModel: (): Promise<LocalCaptionModelActionResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_DOWNLOAD),
    cancelModelDownload: (): Promise<LocalCaptionActionResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_CANCEL),
    removeModel: (): Promise<LocalCaptionModelActionResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_REMOVE),
    start: (sessionId: string, generation: number): Promise<LocalCaptionActionResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START, { sessionId, generation }),
    pushAudio: (chunk: LocalCaptionPcmChunk): Promise<LocalCaptionAudioPushResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_AUDIO_PUSH, chunk),
    stop: (sessionId: string, generation: number): Promise<LocalCaptionActionResult> =>
      invokeIpc(IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_STOP, { sessionId, generation }),
    onModelState: (callback: (state: LocalCaptionModelState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: LocalCaptionModelState) =>
        callback(state);
      ipcRenderer.on(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_STATE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_STATE, handler);
    },
    onRecognizerState: (callback: (state: LocalCaptionRecognizerState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: LocalCaptionRecognizerState) =>
        callback(state);
      ipcRenderer.on(IPC_CHANNELS.LOCAL_CAPTIONS_RECOGNIZER_STATE, handler);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.LOCAL_CAPTIONS_RECOGNIZER_STATE, handler);
    },
    onResult: (callback: (result: LocalCaptionResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: LocalCaptionResult) =>
        callback(result);
      ipcRenderer.on(IPC_CHANNELS.LOCAL_CAPTIONS_RESULT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LOCAL_CAPTIONS_RESULT, handler);
    },
  },

  // ========== Chat ==========
  chat: {
    /**
     * Kick chat history snapshot used to seed the message list on join.
     * `channelId` is the Kick channel's internal db id (already surfaced as
     * `UnifiedChannel.id` via getPublicChannel). Returns null data on
     * Cloudflare challenge / network failure — treat that as "no history".
     */
    getKickHistory: (params: {
      channelId: string;
      channelSlug: string;
    }): Promise<{
      success: boolean;
      data?: {
        messages: Array<{
          id: string;
          chatroom_id: number;
          content: string;
          type: string;
          created_at: string;
          sender: {
            id: number;
            username: string;
            slug: string;
            identity: {
              color: string;
              badges: Array<{ type: string; text: string; count?: number }>;
            };
          };
          metadata: string | null;
        }>;
        pinnedMessage: unknown | null;
      } | null;
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.CHAT_GET_KICK_HISTORY, params),

    /**
     * Twitch chat history snapshot via recent-messages.robotty.de. Returns raw
     * IRC frames the renderer parses with `parseRawTwitchIrcLine`. Returns
     * null data on network failure / service outage — treat that as "no
     * history" and fall back to live-only.
     */
    getTwitchHistory: (params: {
      channel: string;
    }): Promise<{
      success: boolean;
      data?: { rawMessages: string[] } | null;
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY, params),

    getTwitchBadgeCatalog: (params: {
      broadcasterId: string;
      channelLogin: string;
      forceRefresh?: boolean;
    }): Promise<IpcResult<TwitchBadgeCatalog>> =>
      invokeIpc(IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG, params),

    /**
     * Twitch pinned-message GQL is routed through main so renderer DevTools do
     * not log Chromium `net::ERR_*` fetch failures during transient DNS/network
     * outages. Data stays raw because the renderer-side poller owns
     * normalization and diffing.
     */
    getTwitchPinnedMessage: (params: { channel: string }): Promise<IpcResult<unknown | null>> =>
      invokeIpc(IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE, params),

    enrichMentionUsers: (params: {
      platform: Platform;
      channel?: string;
      users: Array<{ userId?: string; username: string }>;
    }): Promise<{
      success: boolean;
      data?: Array<{
        userId: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
      }>;
      error?: string;
    }> => invokeIpc(IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS, params),

    checkSubscriberEligibility: (
      request: SubscriberEligibilityRequest
    ): Promise<SubscriberEligibilityResult> =>
      invokeIpc(IPC_CHANNELS.CHAT_CHECK_SUBSCRIBER_ELIGIBILITY, request),
  },

  // ========== Kick Chat Send (main-only send-window over IPC) ==========
  // The Kick send-window owns a hidden BrowserWindow, a webRequest
  // bearer interceptor, and runs executeJavaScript on kick.com to fire
  // chat sends from inside the page. All of that is main-only; the
  // renderer's kick-chat service goes through these three calls so it
  // never statically imports `kick-send-window` (which would drag
  // electron + the storage / database-service chain into the renderer
  // bundle and break the build).
  kickChat: {
    ensureSendWindowReady: (): Promise<void> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY),
    sendMessage: (
      chatroomId: number,
      content: string,
      channelSlug?: string
    ): Promise<KickSendResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE, {
        chatroomId,
        content,
        channelSlug,
      }),
    banUser: (channelSlug: string, username: string): Promise<KickWebApiMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_BAN_USER, {
        channelSlug,
        username,
      }),
    timeoutUser: (
      channelSlug: string,
      username: string,
      duration: number
    ): Promise<KickWebApiMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_TIMEOUT_USER, {
        channelSlug,
        username,
        duration,
      }),
    unbanUser: (channelSlug: string, username: string): Promise<KickWebApiMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_UNBAN_USER, {
        channelSlug,
        username,
      }),
    deleteMessage: (chatroomId: number, messageId: string): Promise<KickWebApiMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_DELETE_MESSAGE, {
        chatroomId,
        messageId,
      }),
    getViewerRole: (channelSlug: string): Promise<KickChannelViewerRoleResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_GET_VIEWER_ROLE, { channelSlug }),
    pinMessage: (payload: KickPinPayload): Promise<KickPinMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_PIN_MESSAGE, payload),
    unpinMessage: (channelSlug: string): Promise<KickPinMutationResult> =>
      invokeIpc(IPC_CHANNELS.KICK_CHAT_UNPIN_MESSAGE, { channelSlug }),
    disposeSendWindow: (): Promise<void> => invokeIpc(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW),
  },

  // ========== Third-party emotes ==========
  // 7TV / BTTV / FFZ REST runs in main so the 404s for channels with no
  // linked / known account never reach renderer DevTools. See ADR-0004.
  emotes: {
    get7TVUserByConnection: (
      platform: Platform,
      identifier: string
    ): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION>> =>
      invokeIpc(IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION, { platform, identifier }),
    get7TVGlobalEmoteSet: (): Promise<
      EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET>
    > => invokeIpc(IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET),
    bttv: {
      getBadges: (): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_BTTV_GET_BADGES>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_BTTV_GET_BADGES),
      getGlobal: (): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL),
      getUserByTwitchId: (
        channelId: string
      ): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID, { channelId }),
    },
    ffz: {
      getBadges: (): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_FFZ_GET_BADGES>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_FFZ_GET_BADGES),
      getGlobal: (): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL),
      getRoom: (
        request: FfzRoomRequest
      ): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_FFZ_GET_ROOM>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_FFZ_GET_ROOM, request),
    },
    kick: {
      getChannelEmotes: (params: {
        slug: string;
        accessToken?: string;
      }): Promise<EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES>> =>
        invokeIpc(IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES, params),
      getUserSubscriptions: (): Promise<
        EmoteIpcResponse<typeof IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS>
      > => invokeIpc(IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS),
    },
  },

  // ========== Ad Blocking ==========
  adblock: {
    getStatus: (): Promise<{
      networkBlockingEnabled: boolean;
      cosmeticFilteringEnabled: boolean;
    }> => invokeIpc(IPC_CHANNELS.ADBLOCK_GET_STATUS),
    toggle: (options: {
      network?: boolean;
      cosmetic?: boolean;
    }): Promise<{ networkBlockingEnabled: boolean; cosmeticFilteringEnabled: boolean }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_TOGGLE, options),
    getStats: (): Promise<{
      totalBlocked: number;
      byCategory: Record<string, number>;
      recentBlocked: string[];
    }> => invokeIpc(IPC_CHANNELS.ADBLOCK_GET_STATS),
    injectCosmetics: (): Promise<{ injected: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_INJECT_COSMETICS),
    // Stream proxy cleanup - prevents memory leaks
    clearProxyStreamInfo: (channelName: string): Promise<{ success: boolean }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_STREAM, { channelName }),
    clearAllProxyStreamInfos: (): Promise<{ success: boolean }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_ALL),
    // VAFT pattern management
    getPatterns: (): Promise<{
      version: number;
      adSignifiers: string[];
      dateRangePatterns: string[];
      backupPlayerTypes: string[];
      lastUpdated: string;
    }> => invokeIpc(IPC_CHANNELS.ADBLOCK_PATTERNS_GET),
    refreshPatterns: (): Promise<{ success: boolean; patterns: unknown }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH),
    getPatternStats: (): Promise<{
      version: number;
      dateRangePatternCount: number;
      signifierCount: number;
      backupPlayerTypeCount: number;
      lastChecked: string;
      autoUpdateEnabled: boolean;
    }> => invokeIpc(IPC_CHANNELS.ADBLOCK_PATTERNS_GET_STATS),
    setPatternAutoUpdate: (enabled: boolean): Promise<{ autoUpdateEnabled: boolean }> =>
      invokeIpc(IPC_CHANNELS.ADBLOCK_PATTERNS_SET_AUTO_UPDATE, { enabled }),
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
    }> => invokeIpc(IPC_CHANNELS.UPDATE_CHECK),

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
    }> => invokeIpc(IPC_CHANNELS.UPDATE_DOWNLOAD),

    install: (): Promise<{ success: boolean }> => invokeIpc(IPC_CHANNELS.UPDATE_INSTALL),

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
      autoCheckEnabled: boolean;
      checkFrequency: CheckFrequency;
      updateCheckUrl: string;
    }> => invokeIpc(IPC_CHANNELS.UPDATE_GET_STATUS),

    setAllowPrerelease: (
      allow: boolean
    ): Promise<{
      status: string;
      allowPrerelease: boolean;
    }> => invokeIpc(IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE, { allow }),

    setAutoCheck: (settings: {
      enabled?: boolean;
      frequency?: CheckFrequency;
      updateCheckUrl?: string;
    }): Promise<{
      status: string;
      allowPrerelease: boolean;
      autoCheckEnabled: boolean;
      checkFrequency: CheckFrequency;
      updateCheckUrl: string;
    }> => invokeIpc(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK, settings),

    getSettings: (): Promise<{
      allowPrerelease: boolean;
      autoCheckEnabled: boolean;
      checkFrequency: CheckFrequency;
      updateCheckUrl: string;
    }> => invokeIpc(IPC_CHANNELS.UPDATE_GET_SETTINGS),

    onStatusChange: (callback: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (isUpdateState(state)) callback(state);
      };
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ON_STATUS_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ON_STATUS_CHANGE, handler);
    },

    onProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
        if (isUpdateProgress(progress)) callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ON_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ON_PROGRESS, handler);
    },
  },

  // ========== App Environment ==========
  // Snapshot of the runtime environment (isDev, platform, app/electron/node
  // versions). Used by the Settings UI to dev-gate the LogsSection and by the
  // bug-report flow to stamp every report with the build triple.
  env: {
    get: (): Promise<AppEnvironment> => invokeIpc(IPC_CHANNELS.APP_GET_ENVIRONMENT),
  },

  // ========== Bug Reports ==========
  // Renderer-driven bug-report capture. `write` stitches the description,
  // tailed main log, and tailed noise log into a markdown file in the
  // bug-reports directory and returns the saved path (or an error). The
  // open-folder / list / get-dir helpers drive the recent-reports UI.
  bugReports: {
    write: (payload: {
      description: string;
      includeMainLog: boolean;
      includeNoiseLog: boolean;
    }): Promise<BugReportResult> => invokeIpc(IPC_CHANNELS.BUG_REPORT_WRITE, payload),

    openFolder: (): Promise<{ ok: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER),

    getDir: (): Promise<string> => invokeIpc(IPC_CHANNELS.BUG_REPORT_GET_DIR),

    list: (): Promise<string[]> => invokeIpc(IPC_CHANNELS.BUG_REPORT_LIST),
  },

  // ========== Logging ==========
  // Renderer → main logging bridge: fire-and-forget log forwarding plus the
  // read-only helpers the Settings → Logs panel uses to open / inspect the
  // session log files. The main-process LOG_WRITE handler validates `level`
  // and prefixes the tag with `Renderer:` before formatting, so a tampered
  // payload from the webContents can't masquerade as a main-process line.
  logs: {
    write: (payload: {
      level: "debug" | "info" | "warn" | "error";
      tag: string;
      message: string;
      meta?: Record<string, unknown>;
    }): void => sendIpc(IPC_CHANNELS.LOG_WRITE, payload),
    openFolder: (): Promise<{ ok: boolean; error?: string }> =>
      invokeIpc(IPC_CHANNELS.LOGS_OPEN_FOLDER),
    getCurrentPath: (): Promise<string> => invokeIpc(IPC_CHANNELS.LOGS_GET_CURRENT_PATH),
    getNoisePath: (): Promise<string | null> => invokeIpc(IPC_CHANNELS.LOGS_GET_NOISE_PATH),
    getNetworkPath: (): Promise<string | null> => invokeIpc(IPC_CHANNELS.LOGS_GET_NETWORK_PATH),
    tail: (payload: {
      lines: number;
      file: "main" | "noise" | "network";
      level?: "debug" | "info" | "warn" | "error";
      tag?: string;
      query?: string | string[];
    }): Promise<string[]> => invokeIpc(IPC_CHANNELS.LOGS_TAIL, payload),
  },

  // ========== Platform Health ==========
  // `get()` hydrates; `onChange` subscribes to transition pushes and returns
  // an unsubscribe for useEffect cleanup. See ADR-0002.
  platformHealth: {
    get: (): Promise<{
      kick: PlatformHealth;
      twitch: PlatformHealth;
      details?: { kick?: StatusPageDetail; twitch?: StatusPageDetail };
    }> => invokeIpc(IPC_CHANNELS.PLATFORM_HEALTH_GET),
    onChange: (callback: (event: PlatformHealthEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: PlatformHealthEvent) =>
        callback(payload);
      ipcRenderer.on(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, handler);
    },
  },

  // ========== Mod Log ==========
  modLog: {
    insert: (entry: ModLogWriteEntry): Promise<ModLogInsertResult> =>
      invokeIpc(IPC_CHANNELS.MODLOG_INSERT, { entry }),
    query: (filters: ModLogQueryFilters): Promise<ModerationHistoryResult> =>
      invokeIpc(IPC_CHANNELS.MODLOG_QUERY, { filters }),
    sweepRetention: (now?: number): Promise<number> =>
      invokeIpc(IPC_CHANNELS.MODLOG_SWEEP_RETENTION, { now }),
  },

  // ========== State-aware Moderation ==========
  moderation: {
    createTimeoutSnapshot: (binding: TimeoutActionBinding): Promise<TimeoutSnapshotResult> =>
      invokeIpc(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT, binding),
    submitTimeout: (input: TimeoutSubmitInput): Promise<TimeoutSubmitResult> =>
      invokeIpc(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT, input),
  },

  // ========== Retention Settings ==========
  retention: {
    get: (scope: RetentionScope): Promise<number | null | undefined> =>
      invokeIpc(IPC_CHANNELS.RETENTION_GET, { scope }),
    set: (scope: RetentionScope, days: number | null): Promise<void> =>
      invokeIpc(IPC_CHANNELS.RETENTION_SET, { scope, days }),
  },

  // ========== Slot Controller (slice 04 of renderer-OOM PRD #51) ==========
  // Host commands main, and subscribes to main's dispatch fan-out + presence
  // notifications. Slice 04 has no per-slot WebContentsView yet — the host
  // renderer is the temporary consumer of `onLoadStream` etc., to be replaced
  // by the per-slot WCV preload in slice 05.
  slot: {
    requestFocus: (slotId: string): Promise<void> =>
      invokeIpc(IPC_CHANNELS.SLOT_REQUEST_FOCUS, { slotId }),
    setMultiviewCap: (cap: number): Promise<void> =>
      invokeIpc(IPC_CHANNELS.SLOT_SET_MULTIVIEW_CAP, { cap }),
    setBackgroundQuality: (mode: SlotQualityMode): Promise<void> =>
      invokeIpc(IPC_CHANNELS.SLOT_SET_BACKGROUND_QUALITY, { mode }),
    rebindExistingSlots: (): Promise<void> => invokeIpc(IPC_CHANNELS.SLOT_REBIND_EXISTING_SLOTS),
    onLoadStream: (
      callback: (event: { slotId: string; payload: LoadStreamPayload }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { slotId: string; payload: LoadStreamPayload }
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_LOAD_STREAM, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_LOAD_STREAM, handler);
    },
    onSetMute: (callback: (event: { slotId: string; muted: boolean }) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { slotId: string; muted: boolean }
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_SET_MUTE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_MUTE, handler);
    },
    onSetQuality: (
      callback: (event: { slotId: string; config: SlotQualityConfig }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { slotId: string; config: SlotQualityConfig }
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_SET_QUALITY, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_QUALITY, handler);
    },
    onSetBufferConfig: (
      callback: (event: { slotId: string; config: SlotBufferConfig }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { slotId: string; config: SlotBufferConfig }
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_SET_BUFFER_CONFIG, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_SET_BUFFER_CONFIG, handler);
    },
    onUnload: (callback: (event: { slotId: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { slotId: string }) =>
        callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_UNLOAD, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_UNLOAD, handler);
    },
    onPresenceChanged: (
      callback: (event: { slotId: string; presence: SlotPresence }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { slotId: string; presence: SlotPresence }
      ) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_PRESENCE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_PRESENCE_CHANGED, handler);
    },

    // ===== Slice 06 host-side wiring =====
    // Slot lifecycle: host React grid pushes its multistream-store streams
    // into main so each one gets a WCV; pushes removals on unmount.
    createSlot: (slotId: string): Promise<void> => invokeIpc(IPC_CHANNELS.SLOT_CREATE, { slotId }),
    destroySlot: (slotId: string): Promise<void> =>
      invokeIpc(IPC_CHANNELS.SLOT_DESTROY, { slotId }),
    // Push the resolved playback URL so the slot WCV has something to play.
    loadStream: (
      slotId: string,
      payload: { platform: Platform; channelName: string; playbackUrl: string }
    ): Promise<void> => invokeIpc(IPC_CHANNELS.SLOT_LOAD_STREAM_REQUEST, { slotId, payload }),
    // Push slot rect (x, y, width, height) from the React grid's
    // ResizeObserver so main can pin the WCV under the React placeholder.
    setBounds: (
      slotId: string,
      rect: { x: number; y: number; width: number; height: number }
    ): Promise<void> => invokeIpc(IPC_CHANNELS.SLOT_SET_BOUNDS, { slotId, rect }),
    // User clicked the retry overlay after a second-crash affordance.
    requestRetry: (slotId: string): Promise<void> =>
      invokeIpc(IPC_CHANNELS.SLOT_REQUEST_RETRY, { slotId }),
    // Whether the WCV-per-slot path is enabled (env flag during dogfood;
    // becomes always-true once slice 06's host rewrite is signed off).
    isWcvEnabled: (): Promise<boolean> => invokeIpc(IPC_CHANNELS.SLOT_IS_WCV_ENABLED),
    // Main → host push: a slot's WCV crashed twice in the window — render
    // the "click to retry" overlay in the slot's chrome.
    onRetryAffordance: (callback: (event: { slotId: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { slotId: string }) =>
        callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SLOT_RETRY_AFFORDANCE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SLOT_RETRY_AFFORDANCE, handler);
    },
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Type declaration for the exposed API
export type ElectronAPI = typeof electronAPI;
