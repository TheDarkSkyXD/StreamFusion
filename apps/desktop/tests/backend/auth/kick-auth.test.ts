import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthToken, KickUser } from "@/shared/auth-types";

vi.mock("@/lib/cross-logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const mockCookiesGet = vi.fn(
  async (_filter: { domain?: string; name?: string }) => [] as unknown[]
);
const mockCookiesRemove = vi.fn(async (_url: string, _name: string) => undefined);

vi.mock("electron", () => ({
  session: {
    defaultSession: {
      cookies: {
        get: (filter: { domain?: string; name?: string }) => mockCookiesGet(filter),
        remove: (url: string, name: string) => mockCookiesRemove(url, name),
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
  kickUser: Pick<KickUser, "id" | "username"> | null;
} = { token: null, kickUser: null };

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => storageState.token),
    saveToken: vi.fn((_p: string, t: AuthToken) => {
      storageState.token = t;
    }),
    clearToken: vi.fn(() => {
      storageState.token = null;
    }),
    getKickUser: vi.fn(() => storageState.kickUser),
    saveKickUser: vi.fn((u: Pick<KickUser, "id" | "username">) => {
      storageState.kickUser = u;
    }),
    clearKickUser: vi.fn(() => {
      storageState.kickUser = null;
    }),
    clearKickWebBearer: vi.fn(),
  },
}));

const refreshTokenMock = vi.fn();

vi.mock("@/backend/auth/token-exchange", () => ({
  TokenRefreshError: class TokenRefreshError extends Error {
    constructor(
      message: string,
      readonly status: number | null,
      readonly code: string | null
    ) {
      super(message);
      this.name = "TokenRefreshError";
    }
    isPermanent() {
      return this.code === "invalid_grant" || this.status === 401 || this.status === 403;
    }
  },
  tokenExchangeService: {
    refreshToken: (...a: unknown[]) => refreshTokenMock(...a),
  },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const { kickAuthService } = await import("@/backend/auth/kick-auth");
const { storageService } = await import("@/backend/services/storage-service");
const canonicalScopes = [
  "user:read",
  "channel:read",
  "chat:write",
  "moderation:chat_message:manage",
  "moderation:ban",
  "events:subscribe",
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  kickAuthService.cancelProactiveRefresh();
  storageState.token = null;
  storageState.kickUser = null;
  vi.clearAllMocks();
  refreshTokenMock.mockReset();
});

afterEach(() => {
  kickAuthService.cancelProactiveRefresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Guards: Kick access and rotating refresh tokens renew proactively in main without renderer ownership.
// Guards: transient OAuth failures retry without deleting OAuth, website auth, cookies, or identity.
// Guards: only explicit logout clears Kick's independent OAuth and website credential families.
describe("isAuthenticated", () => {
  it("returns false when no token and no user", () => {
    expect(kickAuthService.isAuthenticated()).toBe(false);
  });

  it("returns false when token but no user", () => {
    storageState.token = { accessToken: "at", scope: canonicalScopes };
    expect(kickAuthService.isAuthenticated()).toBe(false);
  });

  it("returns true when both token and user exist", () => {
    storageState.token = { accessToken: "at", scope: canonicalScopes };
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
    storageState.token = {
      accessToken: "at",
      expiresAt: Date.now() + 60_000,
      scope: canonicalScopes,
    };
    expect(kickAuthService.getAccessToken()).toBe("at");
  });

  it("returns access token when expiresAt is absent", () => {
    storageState.token = { accessToken: "at", scope: canonicalScopes };
    expect(kickAuthService.getAccessToken()).toBe("at");
  });

  it("does not authenticate or expose a token with incomplete legacy scopes", () => {
    storageState.token = { accessToken: "legacy", scope: ["user:read"] };
    storageState.kickUser = { id: 1, username: "u" };

    expect(kickAuthService.isAuthenticated()).toBe(false);
    expect(kickAuthService.getAccessToken()).toBeNull();
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
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      scope: canonicalScopes,
    };
    const newToken = { accessToken: "new", refreshToken: "rt2", expiresAt: Date.now() + 3600_000 };
    refreshTokenMock.mockResolvedValueOnce(newToken);

    const result = await kickAuthService.refreshToken();

    expect(result).toEqual({ ...newToken, scope: canonicalScopes });
    expect(storageService.saveToken).toHaveBeenCalledWith("kick", {
      ...newToken,
      scope: canonicalScopes,
    });
  });

  it("preserves the canonical granted scopes when refresh omits scope", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      scope: canonicalScopes,
    };
    refreshTokenMock.mockResolvedValueOnce({ accessToken: "new", refreshToken: "rt2" });

    await expect(kickAuthService.refreshToken()).resolves.toMatchObject({
      accessToken: "new",
      scope: canonicalScopes,
    });
  });

  it("rejects and does not persist an explicitly incomplete refreshed scope set", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      scope: canonicalScopes,
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new",
      refreshToken: "rt2",
      scope: [],
    });

    await expect(kickAuthService.refreshToken()).resolves.toBeNull();
    expect(storageService.saveToken).not.toHaveBeenCalled();
    expect(storageService.clearToken).not.toHaveBeenCalled();
  });

  it("preserves auth state and web cookies on transient refresh failure", async () => {
    storageState.token = { accessToken: "old", refreshToken: "rt" };
    storageState.kickUser = { id: 1, username: "u" };
    refreshTokenMock.mockRejectedValueOnce(new Error("refresh failed"));

    const sessionExpired = vi.fn();
    kickAuthService.on("session-expired", sessionExpired);

    const result = await kickAuthService.refreshToken();

    expect(result).toBeNull();
    expect(storageService.clearToken).not.toHaveBeenCalled();
    expect(storageService.clearKickUser).not.toHaveBeenCalled();
    expect(mockCookiesRemove).not.toHaveBeenCalled();
    expect(sessionExpired).not.toHaveBeenCalled();

    kickAuthService.off("session-expired", sessionExpired);
  });

  it("invalidates only OAuth on permanent rejection and preserves website auth", async () => {
    storageState.token = { accessToken: "old", refreshToken: "rt" };
    storageState.kickUser = { id: 1, username: "u" };
    const { TokenRefreshError } = await import("@/backend/auth/token-exchange");
    refreshTokenMock.mockRejectedValueOnce(new TokenRefreshError("rejected", 401, "invalid_grant"));
    const sessionExpired = vi.fn();
    kickAuthService.on("session-expired", sessionExpired);

    await expect(kickAuthService.refreshToken()).resolves.toBeNull();

    expect(storageService.clearToken).toHaveBeenCalledWith("kick");
    expect(storageService.clearKickUser).not.toHaveBeenCalled();
    expect(storageService.clearKickWebBearer).not.toHaveBeenCalled();
    expect(mockCookiesRemove).not.toHaveBeenCalled();
    expect(sessionExpired).toHaveBeenCalledOnce();
    kickAuthService.off("session-expired", sessionExpired);
  });

  it("deduplicates concurrent refresh calls", async () => {
    storageState.token = { accessToken: "at", refreshToken: "rt", scope: canonicalScopes };
    let resolver: ((v: unknown) => void) | null = null;
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
    storageState.token = { accessToken: "at", refreshToken: "rt", scope: canonicalScopes };
    refreshTokenMock.mockRejectedValueOnce(new Error("fail"));

    await kickAuthService.refreshToken();

    storageState.token = { accessToken: "at2", refreshToken: "rt2", scope: canonicalScopes };
    refreshTokenMock.mockResolvedValueOnce({ accessToken: "ok" });

    const result = await kickAuthService.refreshToken();
    expect(result).toMatchObject({ accessToken: "ok", refreshToken: "rt2" });
    expect(refreshTokenMock).toHaveBeenCalledTimes(2);
  });
});

describe("proactive refresh", () => {
  it("rotates the token five minutes before expiry and schedules the next rotation", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scope: canonicalScopes,
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new",
      refreshToken: "refresh-2",
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });

    kickAuthService.scheduleProactiveRefresh();
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000);

    expect(refreshTokenMock).toHaveBeenCalledOnce();
    expect(storageService.saveToken).toHaveBeenCalledWith(
      "kick",
      expect.objectContaining({ accessToken: "new", refreshToken: "refresh-2" })
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("retries transient refresh failures without clearing either credential family", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scope: canonicalScopes,
    };
    refreshTokenMock
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        accessToken: "new",
        refreshToken: "refresh-2",
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

    kickAuthService.scheduleProactiveRefresh();
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(30 * 1000);

    expect(refreshTokenMock).toHaveBeenCalledTimes(2);
    expect(storageService.clearToken).not.toHaveBeenCalled();
    expect(storageService.clearKickWebBearer).not.toHaveBeenCalled();
    expect(storageService.clearKickUser).not.toHaveBeenCalled();
    expect(mockCookiesRemove).not.toHaveBeenCalled();
  });

  it("re-evaluates an expired token immediately after system resume", async () => {
    storageState.token = {
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1000,
      scope: canonicalScopes,
    };
    refreshTokenMock.mockResolvedValueOnce({
      accessToken: "new",
      refreshToken: "refresh-2",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    kickAuthService.onSystemResume();
    await vi.advanceTimersByTimeAsync(1000);

    expect(refreshTokenMock).toHaveBeenCalledOnce();
  });
});

describe("ensureValidToken", () => {
  it("returns false when no token stored", async () => {
    expect(await kickAuthService.ensureValidToken()).toBe(false);
  });

  it("returns true when token is not expiring soon", async () => {
    storageState.token = {
      accessToken: "at",
      expiresAt: Date.now() + 3600_000,
      scope: canonicalScopes,
    };
    expect(await kickAuthService.ensureValidToken()).toBe(true);
  });

  it("refreshes when token is expiring within 5 minutes", async () => {
    storageState.token = {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 60_000,
      scope: canonicalScopes,
    };
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
    storageState.token = { accessToken: "at", expiresAt: 0, scope: canonicalScopes };
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
    expect(storageService.clearKickWebBearer).toHaveBeenCalledOnce();
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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        data: [{ user_id: 1, name: "u" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await kickAuthService.fetchCurrentUser("explicit-token");

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const headers = call0![1].headers as Record<string, string>;
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
    storageState.token = {
      accessToken: "old",
      refreshToken: "rt",
      scope: canonicalScopes,
    };
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

describe("clearKickSessionCookies (via logout)", () => {
  it("preserves cf_clearance and __cf_bm cookies", async () => {
    mockCookiesGet.mockImplementation(async ({ domain }: { domain?: string; name?: string }) => {
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
    const removeCall = mockCookiesRemove.mock.calls[0];
    expect(removeCall).toBeDefined();
    expect(removeCall![1]).toBe("kick_session");
  });

  it("handles cookie enumeration failure gracefully", async () => {
    mockCookiesGet.mockRejectedValue(new Error("cookie read error"));

    const result = await kickAuthService.logout();

    expect(result).toBe(true);
  });

  it("handles individual cookie removal failure gracefully", async () => {
    mockCookiesGet.mockImplementation(async ({ domain }: { domain?: string; name?: string }) => {
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
    mockCookiesGet.mockImplementation(async ({ domain }: { domain?: string; name?: string }) => {
      if (domain === ".kick.com") {
        return [{ name: "orphan", domain: "", secure: false, path: "/" }];
      }
      return [];
    });

    await kickAuthService.logout();

    expect(mockCookiesRemove).not.toHaveBeenCalled();
  });
});
