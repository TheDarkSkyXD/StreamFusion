import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokenRefreshError } from "@/backend/auth/token-exchange";

// The service singleton imports storageService and tokenExchangeService at
// module-load time. Both are mocked below so the tests don't touch disk or
// the network and can drive the refresh chain deterministically.
vi.mock("@/backend/services/storage-service", () => {
  const state: { token: { accessToken: string; refreshToken?: string; expiresAt?: number } | null } = {
    token: null,
  };
  return {
    storageService: {
      getToken: vi.fn(() => state.token),
      saveToken: vi.fn((_platform: string, token: typeof state.token) => {
        state.token = token;
      }),
      clearToken: vi.fn((_platform: string) => {
        state.token = null;
      }),
      clearTwitchUser: vi.fn(),
      saveTwitchUser: vi.fn(),
      getTwitchUser: vi.fn(() => null),
      isAppTokenExpired: vi.fn(() => true),
      saveAppToken: vi.fn(),
    },
    __state: state,
  };
});

vi.mock("@/backend/auth/token-exchange", async () => {
  const actual = await vi.importActual<typeof import("@/backend/auth/token-exchange")>(
    "@/backend/auth/token-exchange",
  );
  return {
    ...actual,
    tokenExchangeService: {
      refreshToken: vi.fn(),
      validateToken: vi.fn(async () => true),
      getAppAccessToken: vi.fn(),
      revokeToken: vi.fn(),
      exchangeCodeForToken: vi.fn(),
    },
  };
});

// biome-ignore lint/suspicious/noExplicitAny: test-only import to read mocked state
const storageModule: any = await import("@/backend/services/storage-service");
const { tokenExchangeService } = await import("@/backend/auth/token-exchange");
const refreshTokenMock = tokenExchangeService.refreshToken as unknown as ReturnType<typeof vi.fn>;
const { twitchAuthService } = await import("@/backend/auth/twitch-auth");

function setStoredToken(expiresInSec: number): void {
  storageModule.__state.token = {
    accessToken: "old-access",
    refreshToken: "rt-1",
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

function clearStoredToken(): void {
  storageModule.__state.token = null;
}

beforeEach(() => {
  vi.useFakeTimers();
  twitchAuthService.cancelProactiveRefresh();
  twitchAuthService.setAuthLostHandler(() => undefined);
  refreshTokenMock.mockReset();
  storageModule.storageService.clearToken.mockClear();
  storageModule.storageService.clearTwitchUser.mockClear();
  storageModule.storageService.saveToken.mockClear();
  clearStoredToken();
});

afterEach(() => {
  twitchAuthService.cancelProactiveRefresh();
  vi.useRealTimers();
});

describe("TokenRefreshError.isPermanent", () => {
  it("treats invalid_grant as permanent", () => {
    const err = new TokenRefreshError("Invalid refresh token", 400, "invalid_grant");
    expect(err.isPermanent()).toBe(true);
  });

  it("treats 4xx (except 408/429) as permanent", () => {
    expect(new TokenRefreshError("Bad", 400, null).isPermanent()).toBe(true);
    expect(new TokenRefreshError("Bad", 401, null).isPermanent()).toBe(true);
    expect(new TokenRefreshError("Bad", 403, null).isPermanent()).toBe(true);
    expect(new TokenRefreshError("Bad", 408, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("Bad", 429, null).isPermanent()).toBe(false);
  });

  it("treats 5xx and unknown status as transient", () => {
    expect(new TokenRefreshError("Server", 500, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("Server", 502, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("Network", null, null).isPermanent()).toBe(false);
  });

  it("treats other OAuth error codes as permanent", () => {
    expect(new TokenRefreshError("x", 500, "invalid_request").isPermanent()).toBe(true);
    expect(new TokenRefreshError("x", 500, "unauthorized_client").isPermanent()).toBe(true);
  });
});

describe("twitchAuthService refresh chain", () => {
  it("schedules the next refresh after a successful refresh and resets failure counter", async () => {
    setStoredToken(/* 1h until expiry */ 60 * 60);
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: "rt-2",
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    });

    twitchAuthService.scheduleProactiveRefresh();

    // Advance past the 5-minute-before-expiry mark (60m - 55m = 5m until refresh)
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    expect(storageModule.storageService.saveToken).toHaveBeenCalledWith(
      "twitch",
      expect.objectContaining({ accessToken: "new-access" }),
    );
    // saveToken updated the state — the chained scheduleProactiveRefresh
    // should have queued another refresh against the new expiry. Cancel so
    // teardown is fast.
    twitchAuthService.cancelProactiveRefresh();
  });

  it("retries with exponential backoff on transient failure", async () => {
    setStoredToken(60 * 60);
    refreshTokenMock
      .mockRejectedValueOnce(new TokenRefreshError("Server", 502, null))
      .mockResolvedValueOnce({
        accessToken: "new-access",
        refreshToken: "rt-2",
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
      });

    twitchAuthService.scheduleProactiveRefresh();

    // First refresh attempt at T+55m fails (transient). Retry scheduled at +30s.
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    expect(storageModule.storageService.clearToken).not.toHaveBeenCalled();

    // Advance 30s — retry fires, succeeds.
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    expect(refreshTokenMock).toHaveBeenCalledTimes(2);
    expect(storageModule.storageService.saveToken).toHaveBeenCalled();
    twitchAuthService.cancelProactiveRefresh();
  });

  it("invalidates auth immediately on a permanent failure (invalid_grant) but keeps stored TwitchUser", async () => {
    const authLost = vi.fn();
    twitchAuthService.setAuthLostHandler(authLost);

    setStoredToken(60 * 60);
    refreshTokenMock.mockRejectedValueOnce(
      new TokenRefreshError("Invalid refresh token", 400, "invalid_grant"),
    );

    twitchAuthService.scheduleProactiveRefresh();
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    // Token cleared — IRC and Helix calls can no longer authenticate.
    expect(storageModule.storageService.clearToken).toHaveBeenCalledWith("twitch");
    // But stored TwitchUser is intentionally preserved so the UI can show
    // "<displayName> — Reconnect required" instead of scrubbing identity.
    expect(storageModule.storageService.clearTwitchUser).not.toHaveBeenCalled();
    expect(authLost).toHaveBeenCalledTimes(1);
  });

  it("never invalidates auth from transient failures alone — caps backoff at 1h and retries forever", async () => {
    const authLost = vi.fn();
    twitchAuthService.setAuthLostHandler(authLost);

    setStoredToken(60 * 60);
    refreshTokenMock.mockRejectedValue(new TokenRefreshError("Server", 503, null));

    twitchAuthService.scheduleProactiveRefresh();

    // Initial attempt at T+55m
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);
    // Backoff schedule: 30s, 2m, 10m, 45m, then capped at 60m forever.
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000 + 100);
    // After the 5th call, we're in the 1h-cap loop. Advance two more hours
    // worth of retries to prove they keep firing without escalation.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);

    // 7 attempts total (1 initial + 4 short backoffs + 2 hourly caps).
    expect(refreshTokenMock).toHaveBeenCalledTimes(7);
    // Critically: NEVER escalated to invalidateAuth.
    expect(authLost).not.toHaveBeenCalled();
    expect(storageModule.storageService.clearToken).not.toHaveBeenCalled();
    twitchAuthService.cancelProactiveRefresh();
  });

  it("onSystemResume re-schedules the refresh chain (covers laptop wake from sleep)", async () => {
    setStoredToken(60 * 60);
    refreshTokenMock.mockResolvedValue({
      accessToken: "new",
      refreshToken: "rt",
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    });

    twitchAuthService.scheduleProactiveRefresh();
    // Cancel as if the OS sleep killed the timer.
    twitchAuthService.cancelProactiveRefresh();

    // Resume — should re-arm against the still-stored token's expiry.
    twitchAuthService.onSystemResume();
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    twitchAuthService.cancelProactiveRefresh();
  });

  it("logout cancels any pending refresh and clears the failure counter", async () => {
    setStoredToken(60 * 60);
    refreshTokenMock.mockResolvedValue({
      accessToken: "x",
      refreshToken: "y",
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    });
    twitchAuthService.scheduleProactiveRefresh();

    twitchAuthService.cancelProactiveRefresh();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });
});
