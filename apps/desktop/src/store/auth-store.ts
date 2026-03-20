/**
 * Auth Store
 *
 * Zustand store for managing authentication state in the frontend.
 * Communicates with the main process via IPC for secure token storage.
 */

import { create } from "zustand";

import type {
  AuthErrorCode,
  KickUser,
  LocalFollow,
  Platform,
  TwitchUser,
  UserPreferences,
} from "../shared/auth-types";
import type { AuthStatus } from "../shared/ipc-channels";

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

  // Kick
  kickUser: KickUser | null;
  kickConnected: boolean;
  kickLoading: boolean;

  // Guest mode
  isGuest: boolean;

  // Local follows
  localFollows: LocalFollow[];
  followsLoading: boolean;

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

  kickUser: null,
  kickConnected: false,
  kickLoading: false,

  isGuest: true,

  localFollows: [],
  followsLoading: false,

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
        console.debug("🔄 Twitch token expired, attempting auto-refresh...");
        try {
          const refreshResult = await window.electronAPI.auth.refreshTwitchToken();
          if (refreshResult.success) {
            console.debug("✅ Twitch token refreshed successfully");
            // Re-fetch status after refresh
            status = await window.electronAPI.auth.getStatus();
          } else {
            // Refresh failed - token is likely revoked or invalid
            console.warn("⚠️ Token refresh failed:", refreshResult.error);
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
          console.error("❌ Token refresh error:", refreshError);
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
        console.debug("🔄 Kick token expired at startup, attempting auto-refresh...");
        try {
          const refreshResult = await window.electronAPI.auth.refreshKickToken();
          if (refreshResult.success) {
            console.debug("✅ Kick token refreshed at startup");
            status = await window.electronAPI.auth.getStatus();
          } else {
            console.warn("⚠️ Kick token refresh failed at startup:", refreshResult.error);
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
          console.error("❌ Kick token refresh error at startup:", refreshError);
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
        console.warn("⚠️ Kick session expired at runtime — clearing state");
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
    } catch (error) {
      console.error("Failed to initialize auth:", error);
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
      console.debug("⚠️ Twitch login already in progress, ignoring");
      return;
    }

    set({ twitchLoading: true, error: null });
    try {
      // Open popup window with Twitch login page
      await window.electronAPI.auth.openTwitchLogin();

      // After the window closes, refresh auth status to get updated user
      await get().refreshAuthStatus();
    } catch (error) {
      console.error("Failed to login to Twitch:", error);

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
      console.debug("⚠️ Twitch operation already in progress, ignoring");
      return;
    }

    set({ twitchLoading: true });
    try {
      // Use the proper logout function that revokes the token
      await window.electronAPI.auth.logoutTwitch();

      set({
        twitchUser: null,
        twitchConnected: false,
        twitchLoading: false,
        isGuest: !get().kickUser,
      });
    } catch (error) {
      console.error("Failed to logout from Twitch:", error);
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
      console.debug("⚠️ Kick login already in progress, ignoring");
      return;
    }

    set({ kickLoading: true, error: null });
    try {
      await window.electronAPI.auth.openKickLogin();
      // After the window closes, refresh auth status
      await get().refreshAuthStatus();
    } catch (error) {
      console.error("Failed to open Kick login:", error);

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
      console.debug("⚠️ Kick operation already in progress, ignoring");
      return;
    }

    set({ kickLoading: true });
    try {
      await window.electronAPI.auth.clearToken("kick");
      await window.electronAPI.auth.clearKickUser();

      set({
        kickUser: null,
        kickConnected: false,
        kickLoading: false,
        isGuest: !get().twitchUser,
      });
    } catch (error) {
      console.error("Failed to logout from Kick:", error);
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
        kickUser: status.kick.user,
        kickConnected: status.kick.connected,
        isGuest: status.isGuest,
        twitchLoading: false,
        kickLoading: false,
      });
    } catch (error) {
      console.error("Failed to refresh auth status:", error);
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
      console.error("Failed to load follows:", error);
      set({ followsLoading: false });
    }
  },

  addFollow: async (follow) => {
    try {
      const newFollow = await window.electronAPI.follows.add(follow);
      set((state) => ({
        localFollows: [...state.localFollows, newFollow],
      }));
      console.debug("➕ Added follow:", follow.displayName);
      return newFollow;
    } catch (error) {
      console.error("Failed to add follow:", error);
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
        console.debug("➖ Removed follow:", id);
      }
      return removed;
    } catch (error) {
      console.error("Failed to remove follow:", error);
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
      console.error("Failed to update follow:", error);
    }
  },

  isFollowing: async (platform, channelId) => {
    try {
      return await window.electronAPI.follows.isFollowing(platform, channelId);
    } catch (error) {
      console.error("Failed to check follow status:", error);
      return false;
    }
  },

  // ========== Preferences Actions ==========

  loadPreferences: async () => {
    try {
      const preferences = await window.electronAPI.preferences.get();
      set({ preferences });
    } catch (error) {
      console.error("Failed to load preferences:", error);
    }
  },

  updatePreferences: async (updates) => {
    try {
      const updated = await window.electronAPI.preferences.update(updates);
      set({ preferences: updated });
    } catch (error) {
      console.error("Failed to update preferences:", error);
    }
  },
}));

// ========== Selectors ==========
// Note: Avoid using object-returning selectors with Zustand as they cause
// infinite re-renders. Use the hooks from '@/hooks/useAuth' instead,
// which properly memoize the results.

// Simple primitive selectors are fine:
export const selectIsAuthenticated = (state: AuthState) =>
  state.twitchConnected || state.kickConnected;
