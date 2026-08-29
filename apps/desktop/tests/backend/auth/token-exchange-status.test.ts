import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenExchangeService } from "@backend/auth/token-exchange";

// Exercises the real `tokenExchangeService.getTokenStatus` to prove the
// Twitch-vs-Kick validation difference: Twitch hits /validate (OAuth header
// ONLY, no Client-Id) and reads login/user_id/scopes/expiry off the body; Kick
// re-fetches the current user (non-200 = invalid) and sources expiry from the
// stored token. A fetch stub via vi.stubGlobal records the requests.

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-24T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getTokenStatus — Twitch (/validate)", () => {
  it("validates with the OAuth bearer header and NO Client-Id; returns identity/scopes/expiry", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
      jsonResponse({
        client_id: "abc",
        login: "streamer",
        user_id: "12345",
        scopes: ["chat:read", "chat:edit"],
        expires_in: 3600,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const report = await tokenExchangeService.getTokenStatus("twitch", {
      accessToken: "twitch-access",
    });

    expect(report.valid).toBe(true);
    expect(report.login).toBe("streamer");
    expect(report.userId).toBe("12345");
    expect(report.scopes).toEqual(["chat:read", "chat:edit"]);
    // expires_in (seconds) → absolute ms timestamp = now + 3600s.
    expect(report.expiresAt).toBe(Date.now() + 3600 * 1000);

    // The /validate request carries ONLY the OAuth header — never a Client-Id.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://id.twitch.tv/oauth2/validate");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("OAuth twitch-access");
    expect(headers["Client-Id"]).toBeUndefined();
    expect(headers["Client-ID"]).toBeUndefined();
  });

  it("non-200 from /validate → invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false, 401))
    );

    const report = await tokenExchangeService.getTokenStatus("twitch", {
      accessToken: "stale",
    });

    expect(report.valid).toBe(false);
    expect(report.login).toBeUndefined();
  });
});

describe("getTokenStatus — Kick (official introspection + current-user re-fetch)", () => {
  it("uses official introspection scopes instead of synthesized stored scopes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ active: true, scope: "user:read channel:read" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ user_id: 676, name: "kickname" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const report = await tokenExchangeService.getTokenStatus("kick", {
      accessToken: "kick-access",
      scope: [
        "user:read",
        "channel:read",
        "chat:write",
        "moderation:chat_message:manage",
        "moderation:ban",
        "events:subscribe",
      ],
    });

    expect(report.valid).toBe(true);
    expect(report.scopes).toEqual(["user:read", "channel:read"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://id.kick.com/oauth/token/introspect");
  });

  it("200 → valid, OAuth user_id as userId, expiry from STORED token", async () => {
    const grantedScopes = [
      "user:read",
      "channel:read",
      "chat:write",
      "moderation:chat_message:manage",
      "moderation:ban",
      "events:subscribe",
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ active: true, scope: grantedScopes.join(" ") }))
        .mockResolvedValueOnce(jsonResponse({ data: [{ user_id: 676, name: "kickname" }] }))
    );

    const report = await tokenExchangeService.getTokenStatus("kick", {
      accessToken: "kick-access",
      scope: grantedScopes,
      expiresAt: 1_777_000_000_000,
    });

    expect(report.valid).toBe(true);
    expect(report.login).toBe("kickname");
    // The Kick OAuth user_id (676), per the dual-id learning.
    expect(report.userId).toBe("676");
    // Scopes come from the stored token (the API surface returns none).
    expect(report.scopes).toContain("events:subscribe");
    // No expiry from Kick → falls back to the stored token's expiresAt.
    expect(report.expiresAt).toBe(1_777_000_000_000);
  });

  it("never treats stored Kick scopes as proof when introspection reports inactive", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: false, scope: "user:read" }));
    vi.stubGlobal("fetch", fetchMock);

    const report = await tokenExchangeService.getTokenStatus("kick", {
      accessToken: "legacy",
      scope: ["user:read", "channel:read"],
    });

    expect(report).toEqual({
      valid: false,
      scopes: ["user:read"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("non-200 from current-user → invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            active: true,
            scope:
              "user:read channel:read chat:write moderation:chat_message:manage moderation:ban events:subscribe",
          })
        )
        .mockResolvedValueOnce(jsonResponse({}, false, 403))
    );

    const report = await tokenExchangeService.getTokenStatus("kick", {
      accessToken: "kick-access",
      expiresAt: 1_777_000_000_000,
    });

    expect(report.valid).toBe(false);
  });

  it("a thrown fetch (network error) → invalid, never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const report = await tokenExchangeService.getTokenStatus("kick", {
      accessToken: "kick-access",
    });

    expect(report.valid).toBe(false);
  });
});
