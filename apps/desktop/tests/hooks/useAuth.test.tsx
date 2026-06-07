import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAuthError,
  useAuthInitialize,
  useAuthStatus,
  useFollowsManager,
  useIsAuthenticated,
  useIsGuest,
  useKickAuth,
  useLocalFollows,
  usePreferences,
  useTwitchAuth,
  useUserInfo,
} from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth-store";

const twitchUser = {
  id: "1",
  login: "testuser",
  displayName: "TestUser",
  profileImageUrl: "https://example.com/tw.png",
  createdAt: "2020-01-01T00:00:00Z",
  broadcasterType: "",
};

const kickUser = {
  id: 2,
  username: "kickuser",
  profilePic: "https://example.com/kick.png",
};

beforeEach(() => {
  useAuthStore.setState({
    twitchUser: null,
    twitchConnected: false,
    twitchLoading: false,
    kickUser: null,
    kickConnected: false,
    kickLoading: false,
    isGuest: true,
    initialized: false,
    error: null,
    localFollows: [],
    followsLoading: false,
    preferences: null,
  });
});

describe("useTwitchAuth", () => {
  it("returns twitch user state from the store", () => {
    useAuthStore.setState({ twitchUser, twitchConnected: true });
    const { result } = renderHook(() => useTwitchAuth());
    expect(result.current.user).toEqual(twitchUser);
    expect(result.current.connected).toBe(true);
  });
});

describe("useKickAuth", () => {
  it("returns kick user state from the store", () => {
    useAuthStore.setState({ kickUser, kickConnected: true });
    const { result } = renderHook(() => useKickAuth());
    expect(result.current.user).toEqual(kickUser);
    expect(result.current.connected).toBe(true);
  });
});

describe("useIsAuthenticated", () => {
  it("returns false when no platform is connected", () => {
    const { result } = renderHook(() => useIsAuthenticated());
    expect(result.current).toBe(false);
  });

  it("returns true when twitch is connected", () => {
    useAuthStore.setState({ twitchConnected: true });
    const { result } = renderHook(() => useIsAuthenticated());
    expect(result.current).toBe(true);
  });

  it("returns true when kick is connected", () => {
    useAuthStore.setState({ kickConnected: true });
    const { result } = renderHook(() => useIsAuthenticated());
    expect(result.current).toBe(true);
  });
});

describe("useIsGuest", () => {
  it("returns true when isGuest is true", () => {
    useAuthStore.setState({ isGuest: true });
    const { result } = renderHook(() => useIsGuest());
    expect(result.current).toBe(true);
  });

  it("returns false when isGuest is false", () => {
    useAuthStore.setState({ isGuest: false });
    const { result } = renderHook(() => useIsGuest());
    expect(result.current).toBe(false);
  });
});

describe("useAuthStatus", () => {
  it("returns combined status with both platforms", () => {
    useAuthStore.setState({
      twitchUser,
      twitchConnected: true,
      kickUser,
      kickConnected: true,
      initialized: true,
    });
    const { result } = renderHook(() => useAuthStatus());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.anyConnected).toBe(true);
    expect(result.current.bothConnected).toBe(true);
    expect(result.current.initialized).toBe(true);
  });

  it("reports bothConnected=false when only one is connected", () => {
    useAuthStore.setState({ twitchConnected: true, kickConnected: false });
    const { result } = renderHook(() => useAuthStatus());
    expect(result.current.anyConnected).toBe(true);
    expect(result.current.bothConnected).toBe(false);
  });
});

describe("useAuthInitialize", () => {
  it("calls initializeAuth when not initialized", () => {
    const initializeAuth = vi.fn();
    useAuthStore.setState({ initialized: false, initializeAuth });
    renderHook(() => useAuthInitialize());
    expect(initializeAuth).toHaveBeenCalledTimes(1);
  });

  it("does not call initializeAuth when already initialized", () => {
    const initializeAuth = vi.fn();
    useAuthStore.setState({ initialized: true, initializeAuth });
    renderHook(() => useAuthInitialize());
    expect(initializeAuth).not.toHaveBeenCalled();
  });
});

describe("useAuthError", () => {
  it("returns error state", () => {
    useAuthStore.setState({ error: "something failed" });
    const { result } = renderHook(() => useAuthError());
    expect(result.current.error).toBe("something failed");
    expect(result.current.hasError).toBe(true);
  });

  it("returns hasError=false when no error", () => {
    const { result } = renderHook(() => useAuthError());
    expect(result.current.hasError).toBe(false);
  });
});

describe("useUserInfo", () => {
  it("prefers twitch user as primary when both are connected", () => {
    useAuthStore.setState({ twitchUser, kickUser });
    const { result } = renderHook(() => useUserInfo());
    expect(result.current.primaryUser).toEqual(twitchUser);
    expect(result.current.displayName).toBe("TestUser");
    expect(result.current.avatar).toBe("https://example.com/tw.png");
    expect(result.current.hasAnyUser).toBe(true);
  });

  it("falls back to kick user when twitch is not connected", () => {
    useAuthStore.setState({ kickUser });
    const { result } = renderHook(() => useUserInfo());
    expect(result.current.primaryUser).toEqual(kickUser);
    expect(result.current.displayName).toBe("kickuser");
    expect(result.current.avatar).toBe("https://example.com/kick.png");
  });

  it("returns Guest displayName when no user is signed in", () => {
    const { result } = renderHook(() => useUserInfo());
    expect(result.current.displayName).toBe("Guest");
    expect(result.current.avatar).toBeNull();
    expect(result.current.hasAnyUser).toBe(false);
  });
});
