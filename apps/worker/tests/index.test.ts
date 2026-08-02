import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";

function createLimiter(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  };
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    KICK_CLIENT_ID: "kick-client",
    KICK_CLIENT_SECRET: "kick-secret",
    KICK_AUTH_IP_RATE_LIMITER: createLimiter(),
    KICK_AUTH_SUBJECT_RATE_LIMITER: createLimiter(),
    KICK_API_IP_RATE_LIMITER: createLimiter(),
    KICK_API_BEARER_RATE_LIMITER: createLimiter(),
    ...overrides,
  };
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  return worker.fetch(request, env, {} as ExecutionContext);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kick Worker abuse protection", () => {
  it("rejects an exhausted shared auth IP limit before parsing the request body", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv({ KICK_AUTH_IP_RATE_LIMITER: createLimiter(false) });

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.10" },
        body: "not-json",
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("fails closed when the shared auth IP limiter binding is unavailable", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv();
    delete (env as Partial<Env>).KICK_AUTH_IP_RATE_LIMITER;

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/refresh", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: "refresh-value" }),
      }),
      env
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "rate_limit_unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("limits a validated token exchange by a SHA-256 authorization-code key", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const subjectLimiter = createLimiter(false);
    const env = createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter });
    const authorizationCode = "kick-authorization-code";

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: authorizationCode,
          redirect_uri: "http://localhost:8765/auth/kick/callback",
          code_verifier: "a".repeat(43),
        }),
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(subjectLimiter.limit).toHaveBeenCalledOnce();
    const key = vi.mocked(subjectLimiter.limit).mock.calls[0][0].key;
    expect(key).toMatch(/^kick-auth:subject:[a-f0-9]{64}$/);
    expect(key).not.toContain(authorizationCode);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects token exchanges whose redirect URI is outside the localhost callback range", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(Response.json({ access_token: "upstream" }));
    vi.stubGlobal("fetch", upstreamFetch);
    const subjectLimiter = createLimiter();
    const env = createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter });

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: "kick-authorization-code",
          redirect_uri: "https://attacker.example/auth/kick/callback",
          code_verifier: "a".repeat(43),
        }),
      }),
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(subjectLimiter.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects a token exchange without an RFC 7636 code verifier", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(Response.json({ access_token: "upstream" }));
    vi.stubGlobal("fetch", upstreamFetch);
    const subjectLimiter = createLimiter();
    const env = createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter });

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: "kick-authorization-code",
          redirect_uri: "http://localhost:8765/auth/kick/callback",
          code_verifier: "too-short",
        }),
      }),
      env
    );

    expect(response.status).toBe(400);
    expect(subjectLimiter.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects Kick API traffic when its shared per-IP abuse ceiling is exhausted", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const ipLimiter = createLimiter(false);
    const env = createEnv({ KICK_API_IP_RATE_LIMITER: ipLimiter });

    const response = await dispatch(
      new Request("https://worker.test/kick/channels?slug[]=streamer", {
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "X-StreamFusion-Auth": "app",
        },
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: "kick-api:ip:203.0.113.10" });
    expect(env.KICK_API_BEARER_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("limits authenticated Kick API traffic by a SHA-256 bearer-token key", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", upstreamFetch);
    const bearerLimiter = createLimiter(false);
    const env = createEnv({ KICK_API_BEARER_RATE_LIMITER: bearerLimiter });
    const bearerToken = "private-kick-access-token";

    const response = await dispatch(
      new Request("https://worker.test/kick/channels", {
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          Authorization: `Bearer ${bearerToken}`,
        },
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(bearerLimiter.limit).toHaveBeenCalledOnce();
    const key = vi.mocked(bearerLimiter.limit).mock.calls[0][0].key;
    expect(key).toMatch(/^kick-api:bearer:[a-f0-9]{64}$/);
    expect(key).not.toContain(bearerToken);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("fails closed when a limiter throws", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const failingLimiter: RateLimit = {
      limit: vi.fn().mockRejectedValue(new Error("binding unavailable")),
    };
    const env = createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: failingLimiter });

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/refresh", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: "private-refresh-token" }),
      }),
      env
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "rate_limit_unavailable" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("uses fixed shared key families for both valid Kick auth operations", async () => {
    const upstreamFetch = vi
      .fn()
      .mockImplementation(() => Response.json({ access_token: "upstream-token" }));
    vi.stubGlobal("fetch", upstreamFetch);
    const ipLimiter = createLimiter();
    const subjectLimiter = createLimiter();
    const env = createEnv({
      KICK_AUTH_IP_RATE_LIMITER: ipLimiter,
      KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter,
    });
    const headers = {
      "CF-Connecting-IP": "203.0.113.10",
      "Content-Type": "application/json",
    };

    const tokenResponse = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: "authorization-code",
          redirect_uri: "http://localhost:8864/auth/kick/callback",
          code_verifier: "z".repeat(128),
        }),
      }),
      env
    );
    const refreshResponse = await dispatch(
      new Request("https://worker.test/auth/kick/refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
      env
    );

    expect([tokenResponse.status, refreshResponse.status]).toEqual([200, 200]);
    expect(vi.mocked(ipLimiter.limit).mock.calls.map(([options]) => options.key)).toEqual([
      "kick-auth:ip:203.0.113.10",
      "kick-auth:ip:203.0.113.10",
    ]);
    const subjectKeys = vi
      .mocked(subjectLimiter.limit)
      .mock.calls.map(([options]) => options.key);
    expect(subjectKeys).toHaveLength(2);
    expect(subjectKeys.every((key) => /^kick-auth:subject:[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(subjectKeys.join(" ")).not.toContain("authorization-code");
    expect(subjectKeys.join(" ")).not.toContain("refresh-token");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("does not consume Kick counters for preflight, health, or unrelated routes", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv({ KICK_CLIENT_ID: "", KICK_CLIENT_SECRET: "" });

    await dispatch(
      new Request("https://worker.test/auth/kick/token", { method: "OPTIONS" }),
      env
    );
    await dispatch(new Request("https://worker.test/health"), env);
    await dispatch(new Request("https://worker.test/not-a-route"), env);

    expect(env.KICK_AUTH_IP_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(env.KICK_AUTH_SUBJECT_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(env.KICK_API_IP_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(env.KICK_API_BEARER_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("retired Twitch Worker surface", () => {
  it("returns 404 without upstream traffic for every retired Twitch route", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv();
    const requests = [
      new Request("https://worker.test/auth/twitch/token", {
        method: "POST",
        body: JSON.stringify({ code: "obsolete", redirect_uri: "http://localhost" }),
      }),
      new Request("https://worker.test/auth/twitch/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: "obsolete" }),
      }),
      new Request("https://worker.test/auth/twitch/app-token", { method: "POST" }),
      new Request("https://worker.test/twitch/users"),
    ];

    for (const request of requests) {
      const response = await dispatch(request, env);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("Worker health", () => {
  it("reports local Kick configuration without making an upstream request", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(new Request("https://worker.test/health"), createEnv());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      secrets_configured: { kick: true },
      timestamp: expect.any(String),
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not accept state-changing methods on the health route", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(
      new Request("https://worker.test/health", { method: "POST" }),
      createEnv()
    );

    expect(response.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("answers health preflight locally with the Worker CORS contract", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(
      new Request("https://worker.test/health", { method: "OPTIONS" }),
      createEnv()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
