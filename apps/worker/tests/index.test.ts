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
    ...overrides,
  };
}

function tokenRequest(body: Record<string, unknown>, contentType = "application/json"): Request {
  return new Request("https://worker.test/auth/kick/token", {
    method: "POST",
    headers: { "Content-Type": contentType, "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

function refreshRequest(body: Record<string, unknown>, contentType = "application/json"): Request {
  return new Request("https://worker.test/auth/kick/refresh", {
    method: "POST",
    headers: { "Content-Type": contentType, "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

function validTokenBody(): Record<string, unknown> {
  return {
    code: "kick-authorization-code",
    redirect_uri: "http://localhost:8765/auth/kick/callback",
    code_verifier: "a".repeat(43),
  };
}

function validRefreshBody(): Record<string, unknown> {
  return { refresh_token: "kick-refresh-token" };
}

function validKickToken(): Record<string, unknown> {
  return {
    access_token: "kick-access-token",
    token_type: "bearer",
    refresh_token: "kick-refresh-token",
    expires_in: 14_400,
    scope: ["user:read", "channel:read"],
  };
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  return worker.fetch(request, env);
}

function expectAuthHeaders(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Kick Worker OAuth boundary", () => {
  it("builds the authorization-code form and preserves a validated success response", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json(
        { ...validKickToken(), provider_extension: { stripped: true } },
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(tokenRequest(validTokenBody()), createEnv());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(validKickToken());
    expectAuthHeaders(response);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [, init] = upstreamFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(new URLSearchParams(String(init.body))).toEqual(
      new URLSearchParams({
        client_id: "kick-client",
        client_secret: "kick-secret",
        code: "kick-authorization-code",
        grant_type: "authorization_code",
        redirect_uri: "http://localhost:8765/auth/kick/callback",
        code_verifier: "a".repeat(43),
      })
    );
  });

  it("builds the refresh form", async () => {
    const upstreamFetch = vi.fn().mockImplementation(() => Response.json(validKickToken()));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(refreshRequest(validRefreshBody()), createEnv());

    expect(response.status).toBe(200);
    expectAuthHeaders(response);
    const [, init] = upstreamFetch.mock.calls[0];
    expect(new URLSearchParams(String(init.body))).toEqual(
      new URLSearchParams({
        client_id: "kick-client",
        client_secret: "kick-secret",
        refresh_token: "kick-refresh-token",
        grant_type: "refresh_token",
      })
    );
  });

  it("sanitizes an allowlisted OAuth failure", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json(
        { error: "invalid_grant", error_description: "authorization code is confidential" },
        { status: 400 }
      )
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(tokenRequest(validTokenBody()), createEnv());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
    expectAuthHeaders(response);
  });

  it("rejects an unknown OAuth error without forwarding its details", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json(
        { error: "unexpected_failure", error_description: "do not expose this" },
        { status: 400 }
      )
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(tokenRequest(validTokenBody()), createEnv());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_invalid_response" });
    expectAuthHeaders(response);
  });

  it("rejects non-JSON and malformed successful upstream responses", async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>upstream failure</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
      .mockResolvedValueOnce(Response.json({ access_token: "missing-token-type" }));
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv();

    const nonJsonResponse = await dispatch(tokenRequest(validTokenBody()), env);
    const malformedResponse = await dispatch(refreshRequest(validRefreshBody()), env);

    expect(nonJsonResponse.status).toBe(502);
    expect(await nonJsonResponse.json()).toEqual({ error: "upstream_invalid_response" });
    expectAuthHeaders(nonJsonResponse);
    expect(malformedResponse.status).toBe(502);
    expect(await malformedResponse.json()).toEqual({ error: "upstream_invalid_response" });
    expectAuthHeaders(malformedResponse);
  });

  it.each([
    { refresh_token: "", token_type: "bearer", access_token: "access" },
    { expires_in: -1, token_type: "bearer", access_token: "access" },
    { scope: { unexpected: true }, token_type: "bearer", access_token: "access" },
  ])("rejects invalid optional token fields", async (body) => {
    const upstreamFetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(tokenRequest(validTokenBody()), createEnv());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_invalid_response" });
    expectAuthHeaders(response);
  });

  it("returns a stable transport failure without exception text", async () => {
    const upstreamFetch = vi.fn().mockRejectedValue(new Error("upstream connection secret"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(tokenRequest(validTokenBody()), createEnv());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
    expectAuthHeaders(response);
  });

  it("aborts an upstream request after ten seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
    });
    const fetchStarted = Promise.withResolvers<void>();
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchStarted.resolve();
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("upstream request secret", "AbortError")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const responsePromise = dispatch(tokenRequest(validTokenBody()), createEnv());
    await fetchStarted.promise;
    expect(upstreamFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await responsePromise;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "upstream_timeout" });
    expectAuthHeaders(response);
  });

  it("requires application/json after the IP limiter and before body parsing", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const ipLimiter = createLimiter();
    const subjectLimiter = createLimiter();

    const response = await dispatch(
      tokenRequest(validTokenBody(), "text/plain"),
      createEnv({ KICK_AUTH_IP_RATE_LIMITER: ipLimiter, KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expectAuthHeaders(response);
    expect(ipLimiter.limit).toHaveBeenCalledOnce();
    expect(subjectLimiter.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("accepts an application/json content type with a charset", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(Response.json(validKickToken()));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await dispatch(
      tokenRequest(validTokenBody(), "application/json; charset=utf-8"),
      createEnv()
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("rejects token exchanges outside the localhost callback range", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const subjectLimiter = createLimiter();
    const body = {
      ...validTokenBody(),
      redirect_uri: "https://attacker.example/auth/kick/callback",
    };

    const response = await dispatch(
      tokenRequest(body),
      createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter })
    );

    expect(response.status).toBe(400);
    expect(subjectLimiter.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects token exchanges without an RFC 7636 verifier", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const subjectLimiter = createLimiter();
    const body = { ...validTokenBody(), code_verifier: "too-short" };

    const response = await dispatch(
      tokenRequest(body),
      createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter })
    );

    expect(response.status).toBe(400);
    expect(subjectLimiter.limit).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("Kick Worker abuse protection", () => {
  it("preserves limiter order and fixed key families for both grants", async () => {
    const upstreamFetch = vi.fn().mockImplementation(() => Response.json(validKickToken()));
    vi.stubGlobal("fetch", upstreamFetch);
    const order: string[] = [];
    const ipLimiter: RateLimit = {
      limit: vi.fn().mockImplementation(async () => {
        order.push("ip");
        return { success: true };
      }),
    };
    const subjectLimiter: RateLimit = {
      limit: vi.fn().mockImplementation(async () => {
        order.push("subject");
        return { success: true };
      }),
    };
    const env = createEnv({
      KICK_AUTH_IP_RATE_LIMITER: ipLimiter,
      KICK_AUTH_SUBJECT_RATE_LIMITER: subjectLimiter,
    });

    const tokenResponse = await dispatch(tokenRequest(validTokenBody()), env);
    const refreshResponse = await dispatch(refreshRequest(validRefreshBody()), env);

    expect([tokenResponse.status, refreshResponse.status]).toEqual([200, 200]);
    expect(order).toEqual(["ip", "subject", "ip", "subject"]);
    expect(ipLimiter.limit.mock.calls.map(([options]) => options.key)).toEqual([
      "kick-auth:ip:203.0.113.10",
      "kick-auth:ip:203.0.113.10",
    ]);
    const subjectKeys = subjectLimiter.limit.mock.calls.map(([options]) => options.key);
    expect(subjectKeys).toHaveLength(2);
    expect(subjectKeys.every((key) => /^kick-auth:subject:[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(subjectKeys.join(" ")).not.toContain("kick-authorization-code");
    expect(subjectKeys.join(" ")).not.toContain("kick-refresh-token");
  });

  it("fails closed when a limiter is missing or throws", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const envWithoutIpLimiter = createEnv();
    Reflect.deleteProperty(envWithoutIpLimiter, "KICK_AUTH_IP_RATE_LIMITER");
    const missingLimiterResponse = await dispatch(
      refreshRequest(validRefreshBody()),
      envWithoutIpLimiter
    );
    const throwingLimiter: RateLimit = { limit: vi.fn().mockRejectedValue(new Error("binding secret")) };
    const throwingLimiterResponse = await dispatch(
      refreshRequest(validRefreshBody()),
      createEnv({ KICK_AUTH_SUBJECT_RATE_LIMITER: throwingLimiter })
    );

    expect(missingLimiterResponse.status).toBe(503);
    expect(await missingLimiterResponse.json()).toEqual({ error: "rate_limit_unavailable" });
    expectAuthHeaders(missingLimiterResponse);
    expect(throwingLimiterResponse.status).toBe(503);
    expect(await throwingLimiterResponse.json()).toEqual({ error: "rate_limit_unavailable" });
    expectAuthHeaders(throwingLimiterResponse);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects an exhausted shared auth IP limit before parsing the request body", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const env = createEnv({ KICK_AUTH_IP_RATE_LIMITER: createLimiter(false) });

    const response = await dispatch(
      new Request("https://worker.test/auth/kick/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
        body: "not-json",
      }),
      env
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(response.headers.get("Retry-After")).toBe("60");
    expectAuthHeaders(response);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not consume auth counters for unsupported or unrelated routes", async () => {
    const env = createEnv();

    await dispatch(new Request("https://worker.test/auth/kick/token", { method: "OPTIONS" }), env);
    await dispatch(new Request("https://worker.test/not-a-route"), env);

    expect(env.KICK_AUTH_IP_RATE_LIMITER?.limit).not.toHaveBeenCalled();
    expect(env.KICK_AUTH_SUBJECT_RATE_LIMITER?.limit).not.toHaveBeenCalled();
  });
});

describe("Kick Worker route boundary", () => {
  it.each(["/auth/kick/token", "/auth/kick/refresh"])(
    "returns a no-store 404 without CORS for unsupported %s methods",
    async (path) => {
      const upstreamFetch = vi.fn();
      vi.stubGlobal("fetch", upstreamFetch);

      const response = await dispatch(
        new Request(`https://worker.test${path}`, { method: "OPTIONS" }),
        createEnv()
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
      expectAuthHeaders(response);
      expect(upstreamFetch).not.toHaveBeenCalled();
    }
  );

  it("keeps unrelated 404 behavior unchanged", async () => {
    const routes = [
      new Request("https://worker.test/auth/twitch/token", { method: "POST" }),
      new Request("https://worker.test/auth/twitch/refresh", { method: "POST" }),
      new Request("https://worker.test/kick/channels"),
      new Request("https://worker.test/kick/public/v2/categories", { method: "OPTIONS" }),
    ];

    for (const request of routes) {
      const response = await dispatch(request, createEnv());
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
      expect(response.headers.get("Cache-Control")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });
});
