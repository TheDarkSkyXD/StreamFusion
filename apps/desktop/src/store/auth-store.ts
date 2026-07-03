/**
 * Auth Store
 *
 * Zustand store for managing authentication state in the frontend.
 * Communicates with the main process via IPC for secure token storage.
 */

import { create } from "zustand";

import {
  invalidateFollowCachesAfterMutation,
  removePlatformAccountCaches,
} from "@/hooks/queries/cache-invalidation";
import { logger } from "@/renderer/logging/logger";
import { STREAM_KEYS } from "../hooks/queries/useStreams";
import { queryClient } from "../providers/query-provider";
import type {
  AuthErrorCode,
  KickUser,
  LocalFollow,
  Platform,
  TwitchUser,
  UserPreferences,
} from "../shared/auth-types";
import type { AuthStatus } from "../shared/ipc-channels";
import { useFollowStore } from "./follow-store";

// ========== Types ==========

interface AuthError {
  code: AuthErrorCode;
  message: string;
  platform?: Platform;
}

interface AuthState {
  // Twitch
  twitchUser: TwitchUser | null;
  twitchConnected: boolean;
  twitchLoading: boolean;
  /**
   * Set when the main process's refresh chain hits a permanent failure
   * (invalid_grant or similar). The session is dead but we keep twitchUser
   * populated so the UI can show "<displayName> — Reconnect" instead of
   * scrubbing identity entirely. Cleared on a successful loginTwitch.
   */
  twitchReconnectRequired: boolean;

  // Kick
  kickUser: KickUser | null;
  kickConnected: boolean;
  kickLoading: boolean;

  // Guest mode
  isGuest: boolean;

  // Local follows
  localFollows: LocalFollow[];
  followsLoading: boolean;
  followSyncInProgress: boolean;
  followSyncLastSyncedAt: Partial<Record<Platform, string>>;

  // Preferences
  preferences: UserPreferences | null;

  // Error state
  error: AuthError | null;

  // Initialization
  initialized: boolean;

  // Actions - Auth
  initializeAuth: () => Promise<void>;
  loginTwitch: () => Promise<void>;
  logoutTwitch: () => Promise<void>;
  loginKick: () => Promise<void>;
  logoutKick: () => Promise<void>;
  refreshAuthStatus: () => Promise<void>;
  clearError: () => void;

  // Actions - Follows
  loadFollows: () => Promise<void>;
  addFollow: (follow: Omit<LocalFollow, "id" | "followedAt">) => Promise<LocalFollow | null>;
  removeFollow: (id: string) => Promise<boolean>;
  updateFollow: (id: string, updates: Partial<LocalFollow>) => Promise<void>;
  isFollowing: (platform: Platform, channelId: string) => Promise<boolean>;
  syncConnectedFollows: () => Promise<{ synced: Platform[]; failed: Platform[] }>;

  // Actions - Preferences
  loadPreferences: () => Promise<void>;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
}

// ========== Store ==========

export const useAuthStore = create<AuthState>()((set, get) => ({
  // Initial state
  twitchUser: null,
  twitchConnected: false,
  twitchLoading: false,
  twitchReconnectRequired: false,

  kickUser: null,
  kickConnected: false,
  kickLoading: false,

  isGuest: true,

  localFollows: [],
  followsLoading: false,
  followSyncInProgress: false,
  followSyncLastSyncedAt: {},

  preferences: null,

  error: null,
  initialized: false,

  // ========== Auth Actions ==========

  initializeAuth: async () => {
    try {
      // Load auth status first
      let status: AuthStatus = await window.electronAPI.auth.getStatus();

      // If Twitch has a token but it's expired, try to refresh it
      if (status.twitch.hasToken && status.twitch.isExpired) {
        logger.debug("Store:Auth", "twitch token expired, attempting auto-refresh");
        try {
          const refreshResult = await window.electronAPI.auth.refreshTwitchToken();
          if (refreshResult.success) {
            logger.debug("Store:Auth", "twitch token refreshed successfully");
            // Re-fetch status after refresh
            status = await window.electronAPI.auth.getStatus();
          } else {
            // Refresh failed - token is likely revoked or invalid
            logger.warn("Store:Auth", "twitch token refresh failed", {
              error: refreshResult.error,
            });
            // Clear the invalid token and user data
            await window.electronAPI.auth.clearToken("twitch");
            await window.electronAPI.auth.clearTwitchUser();
            // Re-fetch status
            status = await window.electronAPI.auth.getStatus();
            // Set error to notify user they need to reconnect
            set({
              error: {
                code: "TOKEN_EXPIRED",
                message: "Your Twitch session has expired. Please reconnect your account.",
                platform: "twitch",
              },
            });
          }
        } catch (refreshError) {
          logger.error("Store:Auth", "twitch token refresh error", {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
          // Clear invalid credentials
          await window.electronAPI.auth.clearToken("twitch");
          await window.electronAPI.auth.clearTwitchUser();
          status = await window.electronAPI.auth.getStatus();
        }
      }

      // If Kick has a token but it's expired, try to refresh it.
      // This handles the post-rename stale-credential case: tokens issued under
      // the old worker client-id will be permanently invalid — the refresh will
      // fail, kick-auth will clear storage and emit 'session-expired', which the
      // renderer listener below will surface to the user.
      if (status.kick.hasToken && status.kick.isExpired) {
        logger.debug("Store:Auth", "kick token expired at startup, attempting auto-refresh");
        try {
          const refreshResult = await window.electronAPI.auth.refreshKickToken();
          if (refreshResult.success) {
            logger.debug("Store:Auth", "kick token refreshed at startup");
            status = await window.electronAPI.auth.getStatus();
          } else {
            logger.warn("Store:Auth", "kick token refresh failed at startup", {
              error: refreshResult.error,
            });
            // Tokens already cleared by the main process; update status
            status = await window.electronAPI.auth.getStatus();
            set({
              error: {
                code: "TOKEN_EXPIRED",
                message: "Your Kick session has expired. Please reconnect your account.",
                platform: "kick",
              },
            });
          }
        } catch (refreshError) {
          logger.error("Store:Auth", "kick token refresh error at startup", {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
          await window.electronAPI.auth.clearToken("kick");
          await window.electronAPI.auth.clearKickUser();
          status = await window.electronAPI.auth.getStatus();
        }
      }

      // Load local follows
      const follows = await window.electronAPI.follows.getAll();

      // Load preferences
      const preferences = await window.electronAPI.preferences.get();

      set({
        twitchUser: status.twitch.user,
        twitchConnected: status.twitch.connected,
        kickUser: status.kick.user,
        kickConnected: status.kick.connected,
        isGuest: status.isGuest,
        localFollows: follows,
        preferences,
        initialized: true,
        // Don't clear error if it was set above
        error: get().error,
      });

      // Listen for runtime Kick session-expiry events pushed from the main process.
      // This fires when a mid-session refresh fails (e.g. revoked refresh token).
      // The listener is intentionally never unregistered — it lives for the app lifetime.
      window.electronAPI.auth.onKickSessionExpired(() => {
        logger.warn("Store:Auth", "kick session expired at runtime — clearing state");
        removePlatformAccountCaches(queryClient, "kick");
        void useFollowStore.getState().hydrate();
        set({
          kickUser: null,
          kickConnected: false,
          isGuest: !get().twitchUser,
          error: {
            code: "TOKEN_EXPIRED",
            message: "Your Kick session has expired. Please reconnect your account.",
            platform: "kick",
          },
        });
      });

      // Mirror of the Kick listener above for Twitch. Fires when the main
      // process's refresh chain dies permanently — either Twitch rejected the
      // refresh token (invalid_grant from a user de-authorizing the app or
      // long inactivity) or the transient-failure backoff cap was hit. The
      // main process has already cleared the stored token by the time this
      // event arrives; we just sync the UI.
      // Fires when the main process finishes the post-login `syncFollowsOnLogin`
      // bulk import for either platform. The local follows DB now reflects the
      // signed-in user's account follow list — re-hydrate so FollowButton
      // flips to "Following", invalidate the React-Query caches so the
      // Following page and sidebar refetch with the new rows.
      window.electronAPI.auth.onFollowsSynced(({ platform, addedCount, removedCount }) => {
        const netChanged = (addedCount ?? 0) > 0 || (removedCount ?? 0) > 0;
        logger.debug("Store:Auth", "follows synced", {
          platform,
          added: addedCount ?? 0,
          removed: removedCount ?? 0,
        });
        // Hydrate is cheap and idempotent — covers the guest-follows store that
        // doesn't ride React Query.
        void useFollowStore.getState().hydrate();
        // Kick also invalidates on no-op syncs because the verified-follow
        // marker can flip without row diffs. Streams refetch too so live/offline
        // sections update immediately.
        if (platform === "kick" || netChanged) {
          invalidateFollowCachesAfterMutation(queryClient, platform);
        }
      });

      window.electronAPI.auth.onTwitchAuthLost(() => {
        logger.warn(
          "Store:Auth",
          "twitch session expired at runtime — entering reconnect-required mode"
        );
        // Drop renderer-side follow caches the same way explicit logout does;
        // the storage-handlers `activeFollows` fallback (no-token → guest
        // follows) means hydrate() now returns guest data instead of the
        // synced account follows that linger in the DB.
        removePlatformAccountCaches(queryClient, "twitch");
        void useFollowStore.getState().hydrate();
        // Degraded mode: keep twitchUser so the UI can still show the
        // user's identity and a "Reconnect" affordance. twitchConnected
        // flips false so authenticated features (chat send, mod actions,
        // Helix calls) correctly gate off. Anonymous browsing keeps working.
        set({
          twitchConnected: false,
          twitchReconnectRequired: true,
          error: {
            code: "TOKEN_EXPIRED",
            message: "Your Twitch session has expired. Please reconnect your account.",
            platform: "twitch",
          },
        });
      });

      const syncStartupFollows = async (platform: Platform): Promise<void> => {
        try {
          await window.electronAPI.auth.syncFollows(platform);
        } catch (error) {
          logger.warn("Store:Auth", "startup follow sync failed", {
            platform,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
      };

      if (status.twitch.connected) void syncStartupFollows("twitch");
      if (status.kick.connected) void syncStartupFollows("kick");
    } catch (error) {
      logger.error("Store:Auth", "failed to initialize auth", {
        error: error instanceof Error ? error.message : String(error),
      });
      set({
        error: {
          code: "UNKNOWN_ERROR",
          message: "Failed to initialize authentication",
        },
        initialized: true,
      });
    }
  },

  loginTwitch: async () => {
    // Prevent rapid clicking - if already loading, ignore
    if (get().twitchLoading) {
      logger.debug("Store:Auth", "twitch login already in progress, ignoring");
      return;
    }

    set({ twitchLoading: true, error: null });
    try {
      // Open popup window with Twitch login page
      await window.electronAPI.auth.openTwitchLogin();

      // After the window closes, refresh auth status to get updated user
      await get().refreshAuthStatus();

      // Warm the followed-streams cache so /following paints from cache on
      // first nav. The auth'd platform API returns the current followed list
      // even before the background sync writes follows to local DB, so the
      // prefetch is correct without waiting on the sync to complete.
      if (get().twitchConnected) {
        void queryClient.prefetchQuery({
          queryKey: STREAM_KEYS.followed(),
          queryFn: async () => {
            const response = await window.electronAPI.streams.getFollowed({});
            if (response.error) {
              logger.warn("Store:Auth", "prefetch of followed streams failed (non-fatal)", {
                error: response.error,
              });
              return [];
            }
            return response.data ?? [];
          },
        });
      }
    } catch (error) {
      logger.error("Store:Auth", "failed to login to twitch", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });

      // Parse error message and make it user-friendly
      let errorMessage = "Failed to connect to Twitch. Please try again.";
      let shouldShowError = true;

      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("cancelled") || msg.includes("canceled") || msg.includes("closed")) {
          // User cancelled - don't show error, just reset loading
          shouldShowError = false;
        } else if (msg.includes("state mismatch") || msg.includes("security")) {
          // This happens when clicking too fast - just reset and let them try again
          errorMessage = "Connection interrupted. Please try again.";
        } else if (msg.includes("rate") || msg.includes("too many")) {
          errorMessage = "Too many login attempts. Please wait a moment and try again.";
        } else if (msg.includes("network") || msg.includes("fetch")) {
          errorMessage = "Network error. Please check your connection and try again.";
        } else if (msg.includes("not configured")) {
          errorMessage = "Twitch authentication is not configured. Please check your .env file.";
        } else if (msg.includes("timeout")) {
          errorMessage = "Login timed out. Please try again.";
        }
      }

      set({
        error: shouldShowError
          ? {
              code: "UNKNOWN_ERROR",
              message: errorMessage,
              platform: "twitch",
            }
          : null,
        twitchLoading: false,
      });
    }
  },

  logoutTwitch: async () => {
    // Prevent rapid clicking - if already loading, ignore
    if (get().twitchLoading) {
      logger.debug("Store:Auth", "twitch operation already in progress, ignoring");
      return;
    }

    set({ twitchLoading: true });
    try {
      // Use the proper logout function that revokes the token
      await window.electronAPI.auth.logoutTwitch();

      // Drop renderer-side caches that still hold the now-revoked account's
      // follows. Backend already cleared account-source rows; without this,
      // SidebarFollows keeps merging the React-Query cache (enabled:false does
      // not invalidate data) and the in-memory useFollowStore copy (only
      // hydrated at app boot) until the next restart.
      removePlatformAccountCaches(queryClient, "twitch");
      await useFollowStore.getState().hydrate();

      set({
        twitchUser: null,
        twitchConnected: false,
        twitchReconnectRequired: false,
        twitchLoading: false,
        isGuest: !get().kickUser,
      });
    } catch (error) {
      logger.error("Store:Auth", "failed to logout from twitch", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      set({
        error: {
          code: "UNKNOWN_ERROR",
          message: "Failed to logout from Twitch",
          platform: "twitch",
        },
        twitchLoading: false,
      });
    }
  },

  loginKick: async () => {
    // Prevent rapid clicking - if already loading, ignore
    if (get().kickLoading) {
      logger.debug("Store:Auth", "kick login already in progress, ignoring");
      return;
    }

    set({ kickLoading: true, error: null });
    try {
      await window.electronAPI.auth.openKickLogin();
      // After the window closes, refresh auth status
      await get().refreshAuthStatus();
    } catch (error) {
      logger.error("Store:Auth", "failed to open kick login", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });

      // Parse error message and make it user-friendly
      let errorMessage = "Failed to connect to Kick. Please try again.";
      let shouldShowError = true;

      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("cancelled") || msg.includes("canceled") || msg.includes("closed")) {
          // User cancelled - don't show error, just reset loading
          shouldShowError = false;
        } else if (msg.includes("state mismatch") || msg.includes("security")) {
          // This happens when clicking too fast - just reset and let them try again
          errorMessage = "Connection interrupted. Please try again.";
        } else if (msg.includes("rate") || msg.includes("too many")) {
          errorMessage = "Too many login attempts. Please wait a moment and try again.";
        } else if (msg.includes("network") || msg.includes("fetch")) {
          errorMessage = "Network error. Please check your connection and try again.";
        } else if (msg.includes("not configured")) {
          errorMessage = "Kick authentication is not configured. Please check your .env file.";
        } else if (msg.includes("timeout")) {
          errorMessage = "Login timed out. Please try again.";
        }
      }

      set({
        error: shouldShowError
          ? {
              code: "UNKNOWN_ERROR",
              message: errorMessage,
              platform: "kick",
            }
          : null,
        kickLoading: false,
      });
    }
  },

  logoutKick: async () => {
    // Prevent rapid clicking - if already loading, ignore
    if (get().kickLoading) {
      logger.debug("Store:Auth", "kick operation already in progress, ignoring");
      return;
    }

    set({ kickLoading: true });
    try {
      // Route through logoutKick (not the individual clearToken/clearKickUser
      // calls) so kickAuthService.logout() runs end-to-end — clears the OAuth
      // token, the cached user, the kick.com / id.kick.com session cookies
      // from the default Electron session, and the account-source follows in
      // the local DB. Mirrors the logoutTwitch flow above.
      await window.electronAPI.auth.logoutKick();

      // Drop renderer-side caches that still hold the now-revoked account's
      // follows. Backend already cleared account-source rows via
      // clearAccountFollows("kick"); without these the React-Query cache and
      // the in-memory useFollowStore copy keep the synced rows visible until
      // restart.
      removePlatformAccountCaches(queryClient, "kick");
      await useFollowStore.getState().hydrate();

      set({
        kickUser: null,
        kickConnected: false,
        kickLoading: false,
        isGuest: !get().twitchUser,
      });
    } catch (error) {
      logger.error("Store:Auth", "failed to logout from kick", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      set({
        error: {
          code: "UNKNOWN_ERROR",
          message: "Failed to logout from Kick",
          platform: "kick",
        },
        kickLoading: false,
      });
    }
  },

  refreshAuthStatus: async () => {
    try {
      const status: AuthStatus = await window.electronAPI.auth.getStatus();

      set({
        twitchUser: status.twitch.user,
        twitchConnected: status.twitch.connected,
        // A fresh successful connection clears the degraded reconnect flag.
        // Without this, the UI would still show "Reconnect required" right
        // after the user just successfully re-authenticated.
        twitchReconnectRequired: status.twitch.connected ? false : get().twitchReconnectRequired,
        kickUser: status.kick.user,
        kickConnected: status.kick.connected,
        isGuest: status.isGuest,
        twitchLoading: false,
        kickLoading: false,
      });
    } catch (error) {
      logger.error("Store:Auth", "failed to refresh auth status", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  // ========== Follows Actions ==========

  loadFollows: async () => {
    set({ followsLoading: true });
    try {
      const follows = await window.electronAPI.follows.getAll();
      set({ localFollows: follows, followsLoading: false });
    } catch (error) {
      logger.error("Store:Auth", "failed to load follows", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      set({ followsLoading: false });
    }
  },

  addFollow: async (follow) => {
    try {
      const newFollow = await window.electronAPI.follows.add(follow);
      set((state) => ({
        localFollows: [...state.localFollows, newFollow],
      }));
      logger.debug("Store:Auth", "added follow", { displayName: follow.displayName });
      return newFollow;
    } catch (error) {
      logger.error("Store:Auth", "failed to add follow", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return null;
    }
  },

  removeFollow: async (id) => {
    try {
      const removed = await window.electronAPI.follows.remove(id);
      if (removed) {
        set((state) => ({
          localFollows: state.localFollows.filter((f) => f.id !== id),
        }));
        logger.debug("Store:Auth", "removed follow", { id });
      }
      return removed;
    } catch (error) {
      logger.error("Store:Auth", "failed to remove follow", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return false;
    }
  },

  updateFollow: async (id, updates) => {
    try {
      const updated = await window.electronAPI.follows.update(id, updates);
      if (updated) {
        set((state) => ({
          localFollows: state.localFollows.map((f) => (f.id === id ? updated : f)),
        }));
      }
    } catch (error) {
      logger.error("Store:Auth", "failed to update follow", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  },

  isFollowing: async (platform, channelId) => {
    try {
      return await window.electronAPI.follows.isFollowing(platform, channelId);
    } catch (error) {
      logger.error("Store:Auth", "failed to check follow status", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return false;
    }
  },

  syncConnectedFollows: async () => {
    if (get().followSyncInProgress) {
      return { synced: [], failed: [] };
    }

    const platforms: Platform[] = [];
    if (get().twitchConnected) platforms.push("twitch");
    if (get().kickConnected) platforms.push("kick");

    set({ followSyncInProgress: true });
    const synced: Platform[] = [];
    const failed: Platform[] = [];

    try {
      for (const platform of platforms) {
        try {
          const result = await window.electronAPI.auth.syncFollows(platform);
          if (result.success) {
            synced.push(platform);
          } else {
            failed.push(platform);
          }
        } catch (error) {
          failed.push(platform);
          logger.warn("Store:Auth", "manual follow sync failed", {
            platform,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
      }

      if (synced.length > 0) {
        const syncedAt = new Date().toISOString();
        set((state) => ({
          followSyncLastSyncedAt: (() => {
            const next = { ...state.followSyncLastSyncedAt };
            for (const platform of synced) {
              next[platform] = syncedAt;
            }
            return next;
          })(),
        }));
        await useFollowStore.getState().hydrate();
        for (const platform of synced) {
          invalidateFollowCachesAfterMutation(queryClient, platform);
        }
      }

      return { synced, failed };
    } finally {
      set({ followSyncInProgress: false });
    }
  },

  // ========== Preferences Actions ==========

  loadPreferences: async () => {
    try {
      const preferences = await window.electronAPI.preferences.get();
      set({ preferences });
    } catch (error) {
      logger.error("Store:Auth", "failed to load preferences", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  },

  updatePreferences: async (updates) => {
    try {
      const updated = await window.electronAPI.preferences.update(updates);
      set({ preferences: updated });
    } catch (error) {
      logger.error("Store:Auth", "failed to update preferences", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  },
}));

// ========== Selectors ==========
// Note: Avoid using object-returning selectors with Zustand as they cause
// infinite re-renders. Use the hooks from '@/hooks/useAuth' instead,
// which properly memoize the results.

// Simple primitive selectors are fine:
const selectIsAuthenticated = (state: AuthState) => state.twitchConnected || state.kickConnected;
