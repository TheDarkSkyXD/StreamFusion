import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAuthInitialize,
  useAuthStatus,
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

// Guards: useAuthStatus folds twitch + kick connected flags into anyConnected/bothConnected so the multi-platform login screen renders the right CTA on both single- and dual-connect transitions
// Guards: useAuthInitialize fires initializeAuth exactly once across renders when initialized=false, then is a no-op — prevents init-effect runaway on hot-reload
// Guards: useUserInfo prefers twitch over kick when both are connected and falls back to "Guest" with null avatar on cold start, so the user menu never flashes a stale handle
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
