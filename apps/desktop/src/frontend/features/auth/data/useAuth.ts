/**
 * Authentication Hooks
 *
 * React hooks for accessing and managing authentication state.
 */

import { useEffect, useMemo } from "react";

import type { Platform } from "../../../../shared/auth-types";
import { useAuthStore } from "../../../store/auth-store";

// ========== Main Auth Hook ==========

/**
 * Hook to access and manage Twitch authentication
 */
export function useTwitchAuth() {
  const user = useAuthStore((state) => state.twitchUser);
  const connected = useAuthStore((state) => state.twitchConnected);
  const reconnectRequired = useAuthStore((state) => state.twitchReconnectRequired);
  const loading = useAuthStore((state) => state.twitchLoading);
  const authPhase = useAuthStore((state) => state.twitchAuthPhase);
  const login = useAuthStore((state) => state.loginTwitch);
  const logout = useAuthStore((state) => state.logoutTwitch);

  return useMemo(
    () => ({
      user,
      connected,
      reconnectRequired,
      loading,
      authPhase,
      login,
      logout,
    }),
    [user, connected, reconnectRequired, loading, authPhase, login, logout]
  );
}

/**
 * Hook to access and manage Kick authentication
 */
export function useKickAuth() {
  const user = useAuthStore((state) => state.kickUser);
  const connected = useAuthStore((state) => state.kickConnected);
  const loading = useAuthStore((state) => state.kickLoading);
  const login = useAuthStore((state) => state.loginKick);
  const logout = useAuthStore((state) => state.logoutKick);

  return useMemo(
    () => ({
      user,
      connected,
      loading,
      login,
      logout,
    }),
    [user, connected, loading, login, logout]
  );
}

/**
 * Hook to check if user is authenticated on any platform
 */
export function useIsAuthenticated() {
  const twitchConnected = useAuthStore((state) => state.twitchConnected);
  const kickConnected = useAuthStore((state) => state.kickConnected);
  return twitchConnected || kickConnected;
}

/**
 * Hook to check if user is in guest mode
 */
export function useIsGuest() {
  return useAuthStore((state) => state.isGuest);
}

// ========== Auth Status Hook ==========

/**
 * Combined auth status hook
 */
export function useAuthStatus() {
  const twitch = useTwitchAuth();
  const kick = useKickAuth();
  const isGuest = useIsGuest();
  const initialized = useAuthStore((state) => state.initialized);
  const error = useAuthStore((state) => state.error);

  return useMemo(
    () => ({
      twitch,
      kick,
      isGuest,
      isAuthenticated: twitch.connected || kick.connected,
      initialized,
      error,
      anyConnected: twitch.connected || kick.connected,
      bothConnected: twitch.connected && kick.connected,
    }),
    [twitch, kick, isGuest, initialized, error]
  );
}

// ========== Auth Initialization Hook ==========

/**
 * Hook to initialize auth state on app startup
 * Should be called once at the app root
 */
export function useAuthInitialize() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const initialized = useAuthStore((state) => state.initialized);

  useEffect(() => {
    if (!initialized) {
      initializeAuth();
    }
  }, [initialized, initializeAuth]);

  return initialized;
}

// ========== Follows Hooks ==========

/**
 * Hook to access all local follows
 */
export function useLocalFollows() {
  return useAuthStore((state) => state.localFollows);
}

/**
 * Hook to access local follows for a specific platform
 */
export function usePlatformFollows(platform: Platform) {
  const localFollows = useAuthStore((state) => state.localFollows);
  return useMemo(
    () => localFollows.filter((f) => f.platform === platform),
    [localFollows, platform]
  );
}

/**
 * Hook to manage follows
 */
export function useFollowsManager() {
  const localFollows = useLocalFollows();
  const followsLoading = useAuthStore((state) => state.followsLoading);
  const addFollow = useAuthStore((state) => state.addFollow);
  const removeFollow = useAuthStore((state) => state.removeFollow);
  const updateFollow = useAuthStore((state) => state.updateFollow);
  const isFollowing = useAuthStore((state) => state.isFollowing);
  const loadFollows = useAuthStore((state) => state.loadFollows);

  return useMemo(
    () => ({
      follows: localFollows,
      loading: followsLoading,
      addFollow,
      removeFollow,
      updateFollow,
      isFollowing,
      refresh: loadFollows,
    }),
    [localFollows, followsLoading, addFollow, removeFollow, updateFollow, isFollowing, loadFollows]
  );
}

// ========== Preferences Hook ==========

/**
 * Hook to access and manage user preferences
 */
export function usePreferences() {
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);
  const loadPreferences = useAuthStore((state) => state.loadPreferences);

  return useMemo(
    () => ({
      preferences,
      update: updatePreferences,
      refresh: loadPreferences,
    }),
    [preferences, updatePreferences, loadPreferences]
  );
}

// ========== Error Hook ==========

/**
 * Hook to access and clear auth errors
 */
export function useAuthError() {
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  return useMemo(
    () => ({
      error,
      clearError,
      hasError: !!error,
    }),
    [error, clearError]
  );
}

// ========== Platform-Specific Hooks ==========

/**
 * Hook to get combined user info from all platforms
 */
export function useUserInfo() {
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const kickUser = useAuthStore((state) => state.kickUser);

  return useMemo(() => {
    // Prefer Twitch user for display if both connected
    const primaryUser = twitchUser || kickUser;

    return {
      twitchUser,
      kickUser,
      primaryUser,
      displayName: twitchUser?.displayName || kickUser?.username || "Guest",
      avatar: twitchUser?.profileImageUrl || kickUser?.profilePic || null,
      hasAnyUser: !!twitchUser || !!kickUser,
    };
  }, [twitchUser, kickUser]);
}
