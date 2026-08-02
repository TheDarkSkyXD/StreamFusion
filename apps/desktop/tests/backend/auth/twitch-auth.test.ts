import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TWITCH_APP_SCOPES } from "@/shared/auth-types";

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const storageState: {
  token: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string[];
  } | null;
  twitchUser: any;
} = { token: null, twitchUser: null };

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => storageState.token),
    saveToken: vi.fn((_p: string, t: any) => {
      storageState.token = t;
    }),
    clearToken: vi.fn(() => {
      storageState.token = null;
    }),
    getTwitchUser: vi.fn(() => storageState.twitchUser),
    saveTwitchUser: vi.fn((u: any) => {
      storageState.twitchUser = u;
    }),
    clearTwitchUser: vi.fn(() => {
      storageState.twitchUser = null;
    }),
  },
}));

const refreshTokenMock = vi.fn();
const validateTokenMock = vi.fn();
const revokeTokenMock = vi.fn();

vi.mock("@/backend/auth/token-exchange", async () => {
  const actual = await vi.importActual<typeof import("@/backend/auth/token-exchange")>(
    "@/backend/auth/token-exchange"
  );
  return {
    ...actual,
    tokenExchangeService: {
      refreshToken: (...a: unknown[]) => refreshTokenMock(...a),
      validateToken: (...a: unknown[]) => validateTokenMock(...a),
      revokeToken: (...a: unknown[]) => revokeTokenMock(...a),
    },
  };
});

vi.mock("@/backend/auth/oauth-config", () => ({
  getOAuthConfig: vi.fn(() => ({
    platform: "twitch",
    clientId: "test-client-id",
    clientSecret: "",
    authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
    tokenEndpoint: "https://id.twitch.tv/oauth2/token",
    revokeEndpoint: "https://id.twitch.tv/oauth2/revoke",
    scopes: ["chat:read"],
    usesPkce: true,
  })),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const { twitchAuthService } = await import("@/backend/auth/twitch-auth");
const { storageService } = await import("@/backend/services/storage-service");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  storageState.token = null;
  storageState.twitchUser = null;
  vi.clearAllMocks();
  twitchAuthService.cancelProactiveRefresh();
  twitchAuthService.setAuthLostHandler(() => undefined);
});

afterEach(() => {
  twitchAuthService.cancelProactiveRefresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isAuthenticated", () => {
  it("returns false when no token and no user", () => {
    expect(twitchAuthService.isAuthenticated()).toBe(false);
  });

  it("returns false when token but no user", () => {
    storageState.token = { accessToken: "at" };
    expect(twitchAuthService.isAuthenticated()).toBe(false);
  });

  it("returns false when user but no token", () => {
    storageState.twitchUser = { id: "1", login: "u" };
    expect(twitchAuthService.isAuthenticated()).toBe(false);
  });

  it("returns true when both token and user exist", () => {
    storageState.token = { accessToken: "at" };
    storageState.twitchUser = { id: "1", login: "u" };
    expect(twitchAuthService.isAuthenticated()).toBe(true);
  });
});

describe("getAccessToken", () => {
  it("returns null when no token stored", () => {
    expect(twitchAuthService.getAccessToken()).toBeNull();
  });

  it("returns null when token is expired", () => {
    storageState.token = { accessToken: "at", expiresAt: Date.now() - 1000 };
    expect(twitchAuthService.getAccessToken()).toBeNull();
  });

  it("returns the access token when valid and not expired", () => {
    storageState.token = { accessToken: "at", expiresAt: Date.now() + 60_000 };
    expect(twitchAuthService.getAccessToken()).toBe("at");
  });

  it("returns the access token when expiresAt is missing", () => {
    storageState.token = { accessToken: "at" };
    expect(twitchAuthService.getAccessToken()).toBe("at");
  });
});

describe("getCurrentUser", () => {
  it("returns null when no user stored", () => {
    expect(twitchAuthService.getCurrentUser()).toBeNull();
  });

  it("returns stored user", () => {
    storageState.twitchUser = { id: "99", login: "streamer" };
    expect(twitchAuthService.getCurrentUser()).toEqual({ id: "99", login: "streamer" });
  });
});

describe("ensureValidToken", () => {
  it("returns false when no token is stored", async () => {
    const result = await twitchAuthService.ensureValidToken();
    expect(result).toBe(false);
  });

  it("requires a reconnect when a validated token has an explicitly incomplete scope set", async () => {
    storageState.token = {
      accessToken: "at",
      expiresAt: Date.now() + 3600_000,
      scope: ["chat:read"],
    };
    const authLost = vi.fn();
    twitchAuthService.setAuthLostHandler(authLost);

    await expect(twitchAuthService.ensureValidToken()).resolves.toBe(false);
    expect(validateTokenMock).not.toHaveBeenCalled();
    expect(authLost).toHaveBeenCalledOnce();
  });

  it("requires a reconnect when a stored token omits its scope set", async () => {
    storageState.token = {
      accessToken: "at",
      expiresAt: Date.now() + 3600_000,
    };
    const authLost = vi.fn();
    twitchAuthService.setAuthLostHandler(authLost);

    await expect(twitchAuthService.ensureValidToken()).resolves.toBe(false);
    expect(validateTokenMock).not.toHaveBeenCalled();
    expect(authLost).toHaveBeenCalledOnce();
  });

  it("refreshes when token is expired and returns true on success", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() - 1000,
      scope: [...TWITCH_APP_SCOPES],
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new",
      refreshToken: "rt2",
      expiresAt: Date.now() + 3600_000,
    });

    const result = await twitchAuthService.ensureValidToken();

    expect(result).toBe(true);
  });

  it("refreshes when token expires within 5 minutes", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() + 60_000,
      scope: [...TWITCH_APP_SCOPES],
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new",
      refreshToken: "rt2",
      expiresAt: Date.now() + 3600_000,
    });

    const result = await twitchAuthService.ensureValidToken();

    expect(result).toBe(true);
    expect(refreshTokenMock).toHaveBeenCalled();
  });

  it("validates with Twitch if token is not expiring soon", async () => {
    storageState.token = {
      accessToken: "at",
      expiresAt: Date.now() + 3600_000,
      scope: [...TWITCH_APP_SCOPES],
    };
    validateTokenMock.mockResolvedValueOnce(true);

    const result = await twitchAuthService.ensureValidToken();

    expect(result).toBe(true);
    expect(validateTokenMock).toHaveBeenCalledWith("twitch", "at");
  });

  it("refreshes when validation fails and returns false if refresh fails", async () => {
    storageState.token = {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
      scope: [...TWITCH_APP_SCOPES],
    };
    validateTokenMock.mockResolvedValueOnce(false);
    refreshTokenMock.mockResolvedValueOnce(null);

    const result = await twitchAuthService.ensureValidToken();

    expect(result).toBe(false);
  });
});

describe("getValidAccessToken", () => {
  it("returns null when ensureValidToken fails", async () => {
    const result = await twitchAuthService.getValidAccessToken();
    expect(result).toBeNull();
  });

  it("returns access token after ensuring validity", async () => {
    storageState.token = {
      accessToken: "valid-at",
      expiresAt: Date.now() + 3600_000,
      scope: [...TWITCH_APP_SCOPES],
    };
    validateTokenMock.mockResolvedValueOnce(true);

    const result = await twitchAuthService.getValidAccessToken();

    expect(result).toBe("valid-at");
  });
});

describe("logout", () => {
  it("revokes token, clears storage, and cancels proactive refresh", async () => {
    storageState.token = { accessToken: "at-to-revoke", refreshToken: "rt" };
    storageState.twitchUser = { id: "1", login: "user" };
    revokeTokenMock.mockResolvedValueOnce(true);

    const result = await twitchAuthService.logout();

    expect(result).toBe(true);
    expect(revokeTokenMock).toHaveBeenCalledWith({
      platform: "twitch",
      token: "at-to-revoke",
    });
    expect(storageService.clearToken).toHaveBeenCalledWith("twitch");
    expect(storageService.clearTwitchUser).toHaveBeenCalled();
  });

  it("succeeds even when no token is stored (nothing to revoke)", async () => {
    const result = await twitchAuthService.logout();

    expect(result).toBe(true);
    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(storageService.clearToken).toHaveBeenCalled();
  });
});

describe("fetchCurrentUser", () => {
  it("returns null when no access token is available", async () => {
    const result = await twitchAuthService.fetchCurrentUser();
    expect(result).toBeNull();
  });

  it("fetches and transforms user data from Twitch API", async () => {
    storageState.token = { accessToken: "at" };
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: "123",
            login: "streamer",
            display_name: "Streamer",
            profile_image_url: "https://img.test/pic.jpg",
            email: "s@test.com",
            created_at: "2020-01-01T00:00:00Z",
            broadcaster_type: "partner",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await twitchAuthService.fetchCurrentUser();

    expect(result).toEqual({
      id: "123",
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: "https://img.test/pic.jpg",
      email: "s@test.com",
      createdAt: "2020-01-01T00:00:00Z",
      broadcasterType: "partner",
    });
    expect(storageService.saveTwitchUser).toHaveBeenCalled();
  });

  it("uses provided accessToken instead of stored one", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        data: [
          {
            id: "1",
            login: "u",
            display_name: "U",
            profile_image_url: "",
            created_at: "",
            broadcaster_type: "",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await twitchAuthService.fetchCurrentUser("explicit-token");

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const headers = call0![1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer explicit-token");
  });

  it("returns null when API returns empty data array", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [] }))
    );

    const result = await twitchAuthService.fetchCurrentUser();

    expect(result).toBeNull();
  });

  it("returns null on fetch error (never throws)", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );

    const result = await twitchAuthService.fetchCurrentUser();

    expect(result).toBeNull();
  });

  it("attempts refresh on 401 and retries with new token", async () => {
    storageState.token = {
      accessToken: "old-at",
      refreshToken: "rt",
      scope: [...TWITCH_APP_SCOPES],
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new-at",
      refreshToken: "rt2",
      expiresAt: Date.now() + 3600_000,
    });

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        callCount++;
        if (callCount === 1) {
          return jsonResponse({}, false, 401);
        }
        return jsonResponse({
          data: [
            {
              id: "1",
              login: "u",
              display_name: "U",
              profile_image_url: "",
              created_at: "",
              broadcaster_type: "",
            },
          ],
        });
      })
    );

    const result = await twitchAuthService.fetchCurrentUser();

    expect(result).not.toBeNull();
    expect(refreshTokenMock).toHaveBeenCalled();
  });
});

describe("setAuthLostHandler", () => {
  it("is called when invalidateAuth fires (exercised indirectly via schedule)", async () => {
    const { TokenRefreshError } = await import("@/backend/auth/token-exchange");
    const handler = vi.fn();
    twitchAuthService.setAuthLostHandler(handler);

    storageState.token = {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    };
    refreshTokenMock.mockRejectedValueOnce(new TokenRefreshError("Revoked", 400, "invalid_grant"));

    twitchAuthService.scheduleProactiveRefresh();
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000 + 1000);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("single-flight refresh deduplication", () => {
  it("concurrent refreshToken calls share the same in-flight promise", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt" };
    let resolveRefresh: ((v: any) => void) | null = null;
    refreshTokenMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveRefresh = r;
      })
    );

    const p1 = twitchAuthService.refreshToken();
    const p2 = twitchAuthService.refreshToken();

    resolveRefresh!({ accessToken: "new", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });
});
