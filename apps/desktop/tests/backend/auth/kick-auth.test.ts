import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cross-logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const mockCookiesGet = vi.fn(async () => []);
const mockCookiesRemove = vi.fn(async () => undefined);

vi.mock("electron", () => ({
  session: {
    defaultSession: {
      cookies: {
        get: (...a: unknown[]) => mockCookiesGet(...a),
        remove: (...a: unknown[]) => mockCookiesRemove(...a),
      },
    },
  },
}));

const storageState: {
  token: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string[];
  } | null;
  kickUser: any;
  appToken: { accessToken: string; expiresAt?: number } | null;
  appTokenExpired: boolean;
} = { token: null, kickUser: null, appToken: null, appTokenExpired: true };

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => storageState.token),
    saveToken: vi.fn((_p: string, t: any) => {
      storageState.token = t;
    }),
    clearToken: vi.fn(() => {
      storageState.token = null;
    }),
    getKickUser: vi.fn(() => storageState.kickUser),
    saveKickUser: vi.fn((u: any) => {
      storageState.kickUser = u;
    }),
    clearKickUser: vi.fn(() => {
      storageState.kickUser = null;
    }),
    getAppToken: vi.fn(() => storageState.appToken),
    saveAppToken: vi.fn((_p: string, t: any) => {
      storageState.appToken = t;
    }),
    isAppTokenExpired: vi.fn(() => storageState.appTokenExpired),
  },
}));

const refreshTokenMock = vi.fn();
const getAppAccessTokenMock = vi.fn();

vi.mock("@/backend/auth/token-exchange", () => ({
  tokenExchangeService: {
    refreshToken: (...a: unknown[]) => refreshTokenMock(...a),
    getAppAccessToken: (...a: unknown[]) => getAppAccessTokenMock(...a),
  },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const { kickAuthService } = await import("@/backend/auth/kick-auth");
const { storageService } = await import("@/backend/services/storage-service");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  storageState.token = null;
  storageState.kickUser = null;
  storageState.appToken = null;
  storageState.appTokenExpired = true;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isAuthenticated", () => {
  it("returns false when no token and no user", () => {
    expect(kickAuthService.isAuthenticated()).toBe(false);
  });

  it("returns false when token but no user", () => {
    storageState.token = { accessToken: "at" };
    expect(kickAuthService.isAuthenticated()).toBe(false);
  });

  it("returns true when both token and user exist", () => {
    storageState.token = { accessToken: "at" };
    storageState.kickUser = { id: 1, username: "u" };
    expect(kickAuthService.isAuthenticated()).toBe(true);
  });
});

describe("getAccessToken", () => {
  it("returns null when no token stored", () => {
    expect(kickAuthService.getAccessToken()).toBeNull();
  });

  it("returns null when token is expired", () => {
    storageState.token = { accessToken: "at", expiresAt: Date.now() - 1000 };
    expect(kickAuthService.getAccessToken()).toBeNull();
  });

  it("returns access token when valid", () => {
    storageState.token = { accessToken: "at", expiresAt: Date.now() + 60_000 };
    expect(kickAuthService.getAccessToken()).toBe("at");
  });

  it("returns access token when expiresAt is absent", () => {
    storageState.token = { accessToken: "at" };
    expect(kickAuthService.getAccessToken()).toBe("at");
  });
});

describe("getAppAccessToken", () => {
  it("returns null when no app token stored", () => {
    expect(kickAuthService.getAppAccessToken()).toBeNull();
  });

  it("returns null when app token is expired", () => {
    storageState.appToken = { accessToken: "app-at", expiresAt: Date.now() - 1000 };
    expect(kickAuthService.getAppAccessToken()).toBeNull();
  });

  it("returns app access token when valid", () => {
    storageState.appToken = { accessToken: "app-at", expiresAt: Date.now() + 60_000 };
    expect(kickAuthService.getAppAccessToken()).toBe("app-at");
  });
});

describe("getCurrentUser", () => {
  it("returns null when no user stored", () => {
    expect(kickAuthService.getCurrentUser()).toBeNull();
  });

  it("returns stored user", () => {
    storageState.kickUser = { id: 42, username: "kicker" };
    expect(kickAuthService.getCurrentUser()).toEqual({ id: 42, username: "kicker" });
  });
});

describe("refreshToken", () => {
  it("returns null when no refresh token is available", async () => {
    storageState.token = { accessToken: "at" };
    const result = await kickAuthService.refreshToken();
    expect(result).toBeNull();
  });

  it("refreshes and saves new token on success", async () => {
    storageState.token = { accessToken: "old", refreshToken: "rt" };
    const newToken = { accessToken: "new", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 };
    refreshTokenMock.mockResolvedValueOnce(newToken);

    const result = await kickAuthService.refreshToken();

    expect(result).toEqual(newToken);
    expect(storageService.saveToken).toHaveBeenCalledWith("kick", newToken);
  });

  it("clears auth state and emits session-expired on failure", async () => {
    storageState.token = { accessToken: "old", refreshToken: "rt" };
    storageState.kickUser = { id: 1, username: "u" };
    refreshTokenMock.mockRejectedValueOnce(new Error("refresh failed"));

    const sessionExpired = vi.fn();
    kickAuthService.on("session-expired", sessionExpired);

    const result = await kickAuthService.refreshToken();

    expect(result).toBeNull();
    expect(storageService.clearToken).toHaveBeenCalledWith("kick");
    expect(storageService.clearKickUser).toHaveBeenCalled();
    expect(sessionExpired).toHaveBeenCalledTimes(1);

    kickAuthService.off("session-expired", sessionExpired);
  });

  it("deduplicates concurrent refresh calls", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt" };
    let resolver: ((v: any) => void) | null = null;
    refreshTokenMock.mockReturnValueOnce(
      new Promise((r) => {
        resolver = r;
      })
    );

    const p1 = kickAuthService.refreshToken();
    const p2 = kickAuthService.refreshToken();

    resolver!({ accessToken: "new", refreshToken: "rt2" });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight promise after failure so next call retries", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt" };
    refreshTokenMock.mockRejectedValueOnce(new Error("fail"));

    await kickAuthService.refreshToken();

    storageState.token = { accessToken: "at2", refreshToken: "rt2" };
    refreshTokenMock.mockResolvedValueOnce({ accessToken: "ok" });

    const result = await kickAuthService.refreshToken();
    expect(result).toEqual({ accessToken: "ok" });
    expect(refreshTokenMock).toHaveBeenCalledTimes(2);
  });
});

describe("ensureValidToken", () => {
  it("returns false when no token stored", async () => {
    expect(await kickAuthService.ensureValidToken()).toBe(false);
  });

  it("returns true when token is not expiring soon", async () => {
    storageState.token = { accessToken: "at", expiresAt: Date.now() + 3600_000 };
    expect(await kickAuthService.ensureValidToken()).toBe(true);
  });

  it("refreshes when token is expiring within 5 minutes", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 60_000 };
    refreshTokenMock.mockResolvedValueOnce({ accessToken: "new" });

    expect(await kickAuthService.ensureValidToken()).toBe(true);
    expect(refreshTokenMock).toHaveBeenCalled();
  });

  it("returns false when refresh fails on expiring token", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 60_000 };
    refreshTokenMock.mockRejectedValueOnce(new Error("fail"));

    expect(await kickAuthService.ensureValidToken()).toBe(false);
  });

  it("returns true when expiresAt is 0 (treats as no-expiry)", async () => {
    storageState.token = { accessToken: "at", expiresAt: 0 };
    expect(await kickAuthService.ensureValidToken()).toBe(true);
  });
});

describe("logout", () => {
  it("clears token, user, and session cookies", async () => {
    storageState.token = { accessToken: "at" };
    storageState.kickUser = { id: 1, username: "u" };

    const result = await kickAuthService.logout();

    expect(result).toBe(true);
    expect(storageService.clearToken).toHaveBeenCalledWith("kick");
    expect(storageService.clearKickUser).toHaveBeenCalled();
  });

  it("succeeds even when no cookies to clear", async () => {
    mockCookiesGet.mockResolvedValue([]);

    const result = await kickAuthService.logout();

    expect(result).toBe(true);
  });
});

describe("fetchCurrentUser", () => {
  it("returns null when no access token", async () => {
    const result = await kickAuthService.fetchCurrentUser();
    expect(result).toBeNull();
  });

  it("fetches, transforms, and saves user from Kick API", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              user_id: 42,
              name: "KickUser",
              email: "k@test.com",
              profile_picture: "https://img.test/pic.jpg",
            },
          ],
        })
      )
    );

    const result = await kickAuthService.fetchCurrentUser();

    expect(result).toEqual({
      id: 42,
      username: "KickUser",
      slug: "kickuser",
      verified: true,
      email: "k@test.com",
      profilePic: "https://img.test/pic.jpg",
      bio: undefined,
      twitter: undefined,
      discord: undefined,
      instagram: undefined,
      youtube: undefined,
      tiktok: undefined,
      facebook: undefined,
    });
    expect(storageService.saveKickUser).toHaveBeenCalled();
  });

  it("derives slug from name with spaces", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [{ user_id: 1, name: "Cool Streamer Name" }],
        })
      )
    );

    const result = await kickAuthService.fetchCurrentUser();

    expect(result?.slug).toBe("cool-streamer-name");
  });

  it("verified is false when email is absent", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [{ user_id: 1, name: "NoEmail" }],
        })
      )
    );

    const result = await kickAuthService.fetchCurrentUser();

    expect(result?.verified).toBe(false);
  });

  it("profilePic defaults to empty string when absent", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [{ user_id: 1, name: "NoPic" }],
        })
      )
    );

    const result = await kickAuthService.fetchCurrentUser();

    expect(result?.profilePic).toBe("");
  });

  it("uses provided accessToken parameter", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ user_id: 1, name: "u" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await kickAuthService.fetchCurrentUser("explicit-token");

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer explicit-token");
  });

  it("returns null on empty data array", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [] }))
    );

    expect(await kickAuthService.fetchCurrentUser()).toBeNull();
  });

  it("returns null on fetch error (never throws)", async () => {
    storageState.token = { accessToken: "at" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      })
    );

    expect(await kickAuthService.fetchCurrentUser()).toBeNull();
  });

  it("attempts refresh on 401 and retries", async () => {
    storageState.token = { accessToken: "old", refreshToken: "rt" };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new-at",
      refreshToken: "rt2",
    });

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++;
        if (callCount === 1) return jsonResponse({}, false, 401);
        return jsonResponse({ data: [{ user_id: 1, name: "u" }] });
      })
    );

    const result = await kickAuthService.fetchCurrentUser();

    expect(result).not.toBeNull();
    expect(refreshTokenMock).toHaveBeenCalled();
  });
});

describe("ensureValidAppToken", () => {
  it("returns true when app token is not expired", async () => {
    storageState.appTokenExpired = false;
    storageState.appToken = { accessToken: "app-at" };

    expect(await kickAuthService.ensureValidAppToken()).toBe(true);
  });

  it("fetches new app token when expired", async () => {
    getAppAccessTokenMock.mockResolvedValueOnce({ accessToken: "new-app" });

    expect(await kickAuthService.ensureValidAppToken()).toBe(true);
    expect(getAppAccessTokenMock).toHaveBeenCalledWith("kick");
  });

  it("returns false when fetching app token throws", async () => {
    getAppAccessTokenMock.mockRejectedValueOnce(new Error("no secret"));

    expect(await kickAuthService.ensureValidAppToken()).toBe(false);
  });
});

describe("clearKickSessionCookies (via logout)", () => {
  it("preserves cf_clearance and __cf_bm cookies", async () => {
    mockCookiesGet.mockImplementation(async ({ domain }: { domain: string }) => {
      if (domain === ".kick.com") {
        return [
          { name: "cf_clearance", domain: ".kick.com", secure: true, path: "/" },
          { name: "__cf_bm", domain: ".kick.com", secure: true, path: "/" },
          { name: "kick_session", domain: ".kick.com", secure: true, path: "/" },
        ];
      }
      return [];
    });

    await kickAuthService.logout();

    expect(mockCookiesRemove).toHaveBeenCalledTimes(1);
    const removedName = mockCookiesRemove.mock.calls[0][1];
    expect(removedName).toBe("kick_session");
  });

  it("handles cookie enumeration failure gracefully", async () => {
    mockCookiesGet.mockRejectedValue(new Error("cookie read error"));

    const result = await kickAuthService.logout();

    expect(result).toBe(true);
  });

  it("handles individual cookie removal failure gracefully", async () => {
    mockCookiesGet.mockImplementation(async ({ domain }: { domain: string }) => {
      if (domain === "kick.com") {
        return [{ name: "session_token", domain: "kick.com", secure: true, path: "/" }];
      }
      return [];
    });
    mockCookiesRemove.mockRejectedValueOnce(new Error("remove failed"));

    const result = await kickAuthService.logout();

    expect(result).toBe(true);
  });

  it("skips cookies with empty domain", async () => {
    mockCookiesGet.mockImplementation(async ({ domain }: { domain: string }) => {
      if (domain === ".kick.com") {
        return [{ name: "orphan", domain: "", secure: false, path: "/" }];
      }
      return [];
    });

    await kickAuthService.logout();

    expect(mockCookiesRemove).not.toHaveBeenCalled();
  });
});
