import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/utils/cross-logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@backend/auth/oauth-config", () => ({
  getOAuthConfig: vi.fn((platform: string) => {
    if (platform === "twitch") {
      return {
        platform: "twitch",
        clientId: "twitch-client-id",
        clientSecret: "",
        tokenEndpoint: "https://id.twitch.tv/oauth2/token",
        revokeEndpoint: "https://id.twitch.tv/oauth2/revoke",
        scopes: ["chat:read"],
        usesPkce: true,
      };
    }
    return {
      platform: "kick",
      clientId: "kick-client-id",
      clientSecret: "",
      tokenEndpoint: "https://worker.test/auth/kick/token",
      revokeEndpoint: "https://id.kick.com/oauth/revoke",
      scopes: [
        "user:read",
        "channel:read",
        "chat:write",
        "moderation:chat_message:manage",
        "moderation:ban",
        "events:subscribe",
      ],
      usesPkce: true,
    };
  }),
}));

import {
  type TokenExchangeParams,
  TokenRefreshError,
  tokenExchangeService,
} from "@backend/auth/token-exchange";
import { KICK_APP_SCOPES } from "@shared/auth-types";

const { logger } = await import("@shared/utils/cross-logger");

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  vi.mocked(logger.debug).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("exchangeCodeForToken", () => {
  it("rejects Twitch authorization-code exchange before transport", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "unexpected", token_type: "bearer" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      tokenExchangeService.exchangeCodeForToken({
        platform: "twitch",
        code: "legacy-code",
        redirectUri: "http://localhost:8765/auth/twitch/callback",
        pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
      } as unknown as TokenExchangeParams)
    ).rejects.toThrow(/device code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends code + redirect_uri + code_verifier as JSON and returns parsed AuthToken", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        access_token: "at-123",
        refresh_token: "rt-456",
        token_type: "bearer",
        expires_in: 14400,
        scope: "chat:read chat:edit",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "auth-code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "verifier", codeChallenge: "challenge", codeChallengeMethod: "S256" },
    });

    expect(token.accessToken).toBe("at-123");
    expect(token.refreshToken).toBe("rt-456");
    expect(token.expiresAt).toBe(Date.now() + 14400 * 1000);
    expect(token.scope).toEqual(["chat:read", "chat:edit"]);

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const [url, init] = call0!;
    expect(url).toBe("https://worker.test/auth/kick/token");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.code).toBe("auth-code");
    expect(body.redirect_uri).toBe("http://localhost:8765/auth/kick/callback");
    expect(body.code_verifier).toBe("verifier");
  });

  it("omits code_verifier when config does not use PKCE", async () => {
    const { getOAuthConfig } = await import("@backend/auth/oauth-config");
    vi.mocked(getOAuthConfig).mockReturnValueOnce({
      platform: "kick",
      clientId: "kick-id",
      clientSecret: "",
      authorizationEndpoint: "",
      tokenEndpoint: "https://worker.test/auth/kick/token",
      scopes: [],
      usesPkce: false,
    });

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ access_token: "at", token_type: "bearer" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
    });

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const body = JSON.parse(call0![1].body as string);
    expect(body.code_verifier).toBeUndefined();
  });

  it("throws with error_description from a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "invalid_grant", error_description: "Code expired" }, false, 400)
      )
    );

    await expect(
      tokenExchangeService.exchangeCodeForToken({
        platform: "kick",
        code: "bad",
        redirectUri: "http://localhost:8765/auth/kick/callback",
        pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
      })
    ).rejects.toThrow("Code expired");
  });

  it("throws generic message when error response JSON is unparseable", async () => {
    const res = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res)
    );

    await expect(
      tokenExchangeService.exchangeCodeForToken({
        platform: "kick",
        code: "code",
        redirectUri: "http://localhost:8765/auth/kick/callback",
        pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
      })
    ).rejects.toThrow("Token exchange failed");
  });

  it("parses scope as array when returned as array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "at",
          token_type: "bearer",
          scope: ["a", "b"],
        })
      )
    );

    const token = await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
    });

    expect(token.scope).toEqual(["a", "b"]);
  });

  it("uses the canonical requested Kick grant when the code exchange omits scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "at", token_type: "bearer" }))
    );

    const token = await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
    });

    expect(token.scope).toEqual([...KICK_APP_SCOPES]);
  });

  it("preserves an explicitly empty scope response as an empty grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "at", token_type: "bearer", scope: "" }))
    );

    const token = await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
    });

    expect(token.scope).toEqual([]);
  });

  it("leaves expiresAt undefined when expires_in is not in response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "at", token_type: "bearer" }))
    );

    const token = await tokenExchangeService.exchangeCodeForToken({
      platform: "kick",
      code: "code",
      redirectUri: "http://localhost:8765/auth/kick/callback",
      pkce: { codeVerifier: "v", codeChallenge: "c", codeChallengeMethod: "S256" },
    });

    expect(token.expiresAt).toBeUndefined();
  });
});

describe("refreshToken", () => {
  it("refreshes Twitch directly as a public client without a client secret", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        access_token: "new-at",
        refresh_token: "new-rt",
        token_type: "bearer",
        expires_in: 7200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await tokenExchangeService.refreshToken({
      platform: "twitch",
      refreshToken: "old-rt",
    });

    expect(token.accessToken).toBe("new-at");
    expect(token.refreshToken).toBe("new-rt");

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const [url, init] = call0!;
    expect(url).toBe("https://id.twitch.tv/oauth2/token");
    expect(init.headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/x-www-form-urlencoded" })
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_id")).toBe("twitch-client-id");
    expect(body.get("refresh_token")).toBe("old-rt");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.has("client_secret")).toBe(false);
    expect(token.authFlow).toBe("device-code");
  });

  it("keeps Kick refresh on the Worker JSON endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ access_token: "kick-at", refresh_token: "kick-rt", token_type: "bearer" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await tokenExchangeService.refreshToken({
      platform: "kick",
      refreshToken: "old-kick-rt",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://worker.test/auth/kick/refresh");
    expect(init.headers).toEqual(expect.objectContaining({ "Content-Type": "application/json" }));
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "old-kick-rt" });
  });

  it("throws TokenRefreshError with status and error code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "invalid_grant", error_description: "Revoked" }, false, 401)
      )
    );

    try {
      await tokenExchangeService.refreshToken({
        platform: "twitch",
        refreshToken: "dead-rt",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenRefreshError);
      const tErr = err as TokenRefreshError;
      expect(tErr.status).toBe(401);
      expect(tErr.code).toBe("invalid_grant");
      expect(tErr.message).toBe("Revoked");
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("re-throws network errors from fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    await expect(
      tokenExchangeService.refreshToken({ platform: "kick", refreshToken: "rt" })
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("revokeToken", () => {
  it("sends token + client_id as URL-encoded form and returns true", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(null, true, 200)
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await tokenExchangeService.revokeToken({
      platform: "twitch",
      token: "the-token",
    });

    expect(result).toBe(true);

    const call0 = fetchMock.mock.calls[0];
    expect(call0).toBeDefined();
    const [url, init] = call0!;
    expect(url).toBe("https://id.twitch.tv/oauth2/revoke");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(init.body as string).toContain("client_id=twitch-client-id");
    expect(init.body as string).toContain("token=the-token");
  });

  it("returns true even on non-OK response (revoke is best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(null, false, 400))
    );

    const result = await tokenExchangeService.revokeToken({
      platform: "twitch",
      token: "t",
    });

    expect(result).toBe(true);
  });

  it("returns false when no revokeEndpoint is configured", async () => {
    const { getOAuthConfig } = await import("@backend/auth/oauth-config");
    vi.mocked(getOAuthConfig).mockReturnValueOnce({
      platform: "kick",
      clientId: "id",
      clientSecret: "",
      authorizationEndpoint: "",
      tokenEndpoint: "",
      scopes: [],
      usesPkce: false,
    });

    const result = await tokenExchangeService.revokeToken({
      platform: "kick",
      token: "t",
    });

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await tokenExchangeService.revokeToken({
      platform: "twitch",
      token: "t",
    });

    expect(result).toBe(false);
  });
});

describe("validateToken", () => {
  it("validates Twitch token via /validate endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, true, 200))
    );

    const result = await tokenExchangeService.validateToken("twitch", "at");

    expect(result).toBe(true);
  });

  it("returns false for invalid Twitch token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false, 401))
    );

    const result = await tokenExchangeService.validateToken("twitch", "bad");

    expect(result).toBe(false);
  });

  it("validates Kick token via introspect endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        active: true,
        scope:
          "user:read channel:read chat:write moderation:chat_message:manage moderation:ban events:subscribe",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await tokenExchangeService.validateToken("kick", "at");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://id.kick.com/oauth/token/introspect",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("rejects an active Kick token whose introspected scopes are incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ active: true, scope: "user:read channel:read" }))
    );

    await expect(tokenExchangeService.validateToken("kick", "legacy")).resolves.toBe(false);
  });

  it("returns false for inactive Kick token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: { active: false } }))
    );

    const result = await tokenExchangeService.validateToken("kick", "at");

    expect(result).toBe(false);
  });

  it("returns false for unknown platform", async () => {
    const result = await Reflect.apply(tokenExchangeService.validateToken, tokenExchangeService, [
      "youtube",
      "at",
    ]);
    expect(result).toBe(false);
  });

  it("returns false on fetch error (never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );

    const result = await tokenExchangeService.validateToken("twitch", "at");

    expect(result).toBe(false);
  });
});

describe("getTokenStatus", () => {
  it("returns identity/scopes/expiry for unknown platform", async () => {
    const report = await Reflect.apply(tokenExchangeService.getTokenStatus, tokenExchangeService, [
      "youtube",
      { accessToken: "at" },
    ]);
    expect(report).toEqual({ valid: false });
  });

  it("catches thrown errors and returns { valid: false }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );

    const report = await tokenExchangeService.getTokenStatus("twitch", {
      accessToken: "at",
    });

    expect(report).toEqual({ valid: false });
  });
});

describe("TokenRefreshError", () => {
  it("has the correct name property", () => {
    const err = new TokenRefreshError("msg", 400, "invalid_grant");
    expect(err.name).toBe("TokenRefreshError");
  });

  it("isPermanent returns true for all permanent OAuth error codes", () => {
    const permanent = [
      "invalid_grant",
      "invalid_request",
      "invalid_client",
      "unauthorized_client",
      "unsupported_grant_type",
    ];
    for (const code of permanent) {
      expect(new TokenRefreshError("", null, code).isPermanent()).toBe(true);
    }
  });

  it("isPermanent returns false when status is null and code is unknown", () => {
    expect(new TokenRefreshError("", null, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("", null, "server_error").isPermanent()).toBe(false);
  });

  it("isPermanent treats 408 and 429 as transient", () => {
    expect(new TokenRefreshError("", 408, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("", 429, null).isPermanent()).toBe(false);
  });

  it("isPermanent treats other 4xx as permanent", () => {
    expect(new TokenRefreshError("", 400, null).isPermanent()).toBe(true);
    expect(new TokenRefreshError("", 403, null).isPermanent()).toBe(true);
    expect(new TokenRefreshError("", 404, null).isPermanent()).toBe(true);
  });

  it("isPermanent treats 5xx as transient", () => {
    expect(new TokenRefreshError("", 500, null).isPermanent()).toBe(false);
    expect(new TokenRefreshError("", 503, null).isPermanent()).toBe(false);
  });
});
