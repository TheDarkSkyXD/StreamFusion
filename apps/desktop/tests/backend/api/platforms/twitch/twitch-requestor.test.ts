import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

const mockGetValidAccessToken = vi.fn();
const mockIsAuthenticated = vi.fn();
const mockRefreshToken = vi.fn();
const mockGetAccessToken = vi.fn();

vi.mock("@/backend/auth/twitch-auth", () => ({
  twitchAuthService: {
    getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
    isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
    refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  },
}));

vi.mock("@/backend/auth/oauth-config", () => ({
  getOAuthConfig: () => ({ clientId: "test-client-id" }),
}));

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
}));

const mockRecordPlatformSuccess = vi.fn();
const mockRecordPlatformFailure = vi.fn();

vi.mock("@/backend/api/unified/platform-health", () => ({
  recordPlatformSuccess: (...args: unknown[]) => mockRecordPlatformSuccess(...args),
  recordPlatformFailure: (...args: unknown[]) => mockRecordPlatformFailure(...args),
}));

import { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

function spyNetRequest(
  requestor: TwitchRequestor,
  impl: (...args: unknown[]) => Promise<unknown>
) {
  return vi.spyOn(requestor as any, "netRequest").mockImplementation(impl);
}

// Guards: authenticated Helix calls go directly from Electron main to Twitch with main-owned credentials.
// Guards: transient HTTP 500 responses retry so followed-channel pagination survives brief Twitch outages.
describe("TwitchRequestor", () => {
  let requestor: TwitchRequestor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidAccessToken.mockResolvedValue("test-token");
    mockIsAuthenticated.mockReturnValue(true);
    requestor = new TwitchRequestor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("calls Twitch Helix directly with main-owned credentials", async () => {
      const spy = spyNetRequest(requestor, async (url: unknown) => ({
        data: { ok: true },
        status: 200,
        headers: {},
      }));

      const result = await requestor.request("/streams");

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, opts] = spy.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(url).toBe("https://api.twitch.tv/helix/streams");
      expect(opts.headers.Authorization).toBe("Bearer test-token");
      expect(opts.headers["Client-Id"]).toBe("test-client-id");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(result).toEqual({ ok: true });
    });

    it("does not allow request options to override main-owned Twitch credentials", async () => {
      const spy = spyNetRequest(requestor, async () => ({
        data: { ok: true },
        status: 200,
        headers: {},
      }));

      await requestor.request("/streams", {
        headers: {
          Authorization: "Bearer renderer-token",
          "Client-Id": "renderer-client-id",
        },
      });

      const [, opts] = spy.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(opts.headers.Authorization).toBe("Bearer test-token");
      expect(opts.headers["Client-Id"]).toBe("test-client-id");
    });

    it("throws when not authenticated", async () => {
      mockGetValidAccessToken.mockResolvedValueOnce(null);

      await expect(requestor.request("/streams")).rejects.toThrow("Not authenticated");
    });

    it("throws TwitchClientError on 429 rate limit", async () => {
      spyNetRequest(requestor, async () => ({
        data: { message: "Rate limited" },
        status: 429,
        headers: { "retry-after": "30" },
      }));

      await expect(requestor.request("/streams")).rejects.toMatchObject({
        status: 429,
        retryAfter: 30,
      });
    });

    it("uses default retry-after of 60 when header is missing", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 429,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toMatchObject({
        status: 429,
        retryAfter: 60,
      });
    });

    it("attempts token refresh on 401 and retries", async () => {
      mockRefreshToken.mockResolvedValueOnce(true);
      let callCount = 0;
      spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount === 1) return { data: {}, status: 401, headers: {} };
        return { data: { ok: true }, status: 200, headers: {} };
      });

      const result = await requestor.request("/streams");

      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });

    it("throws when 401 and refresh fails", async () => {
      mockRefreshToken.mockResolvedValueOnce(false);
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 401,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow("Authentication failed");
    });

    it("retries on 502/503/504 with exponential backoff", async () => {
      const { sleep } = await import("@/lib/sleep");

      let callCount = 0;
      spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount <= 2) return { data: {}, status: 503, headers: {} };
        return { data: { ok: true }, status: 200, headers: {} };
      });

      const result = await requestor.request("/streams");

      expect(result).toEqual({ ok: true });
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenNthCalledWith(1, 1000);
      expect(sleep).toHaveBeenNthCalledWith(2, 2000);
    });

    it("retries a transient 500 response", async () => {
      const { sleep } = await import("@/lib/sleep");
      const spy = spyNetRequest(requestor, async () =>
        spy.mock.calls.length === 1
          ? { data: {}, status: 500, headers: {} }
          : { data: { ok: true }, status: 200, headers: {} }
      );

      await expect(requestor.request("/channels/followed")).resolves.toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(1000);
    });

    it("throws after exhausting retries on server errors", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 503,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();
    });

    it("throws non-retryable errors immediately without retry", async () => {
      spyNetRequest(requestor, async () => ({
        data: { message: "Bad Request" },
        status: 400,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow("Bad Request");
    });

    it("retries on transient network errors (fetch failed)", async () => {
      const { sleep } = await import("@/lib/sleep");
      let callCount = 0;
      spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount === 1) throw new Error("fetch failed");
        return { data: { ok: true }, status: 200, headers: {} };
      });

      const result = await requestor.request("/streams");

      expect(result).toEqual({ ok: true });
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("retries on ECONNRESET error code", async () => {
      let callCount = 0;
      spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("connection reset");
          (err as any).cause = { code: "ECONNRESET" };
          throw err;
        }
        return { data: { data: [] }, status: 200, headers: {} };
      });

      const result = await requestor.request("/streams");
      expect(result).toEqual({ data: [] });
    });

    it("does not retry non-retryable errors like JSON parse failures", async () => {
      const spy = spyNetRequest(requestor, async () => {
        throw new Error("Failed to parse JSON response");
      });

      await expect(requestor.request("/streams")).rejects.toThrow("Failed to parse JSON response");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("passes custom method and body through", async () => {
      const spy = spyNetRequest(requestor, async () => ({
        data: { created: true },
        status: 200,
        headers: {},
      }));

      await requestor.request("/channels", {
        method: "POST",
        body: JSON.stringify({ title: "New Title" }),
      });

      const [, opts] = spy.mock.calls[0] as [string, { method: string; body: string }];
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ title: "New Title" }));
    });

    it("falls through to generic error when status 4xx has no message", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 418,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow("Twitch API error: 418");
    });
  });

  describe("platform-health instrumentation", () => {
    it("calls recordPlatformSuccess('twitch') on a successful request", async () => {
      spyNetRequest(requestor, async () => ({
        data: { ok: true },
        status: 200,
        headers: {},
      }));

      await requestor.request("/streams");

      expect(mockRecordPlatformSuccess).toHaveBeenCalledWith("twitch");
    });

    it("calls recordPlatformFailure('twitch', 'server-5xx') after retries exhausted on 502", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 502,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "server-5xx");
    });

    it("calls recordPlatformFailure('twitch', 'server-5xx') after retries exhausted on 503", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 503,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "server-5xx");
    });

    it("calls recordPlatformFailure('twitch', 'server-5xx') after retries exhausted on 504", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 504,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "server-5xx");
    });

    it("does NOT call recordPlatformFailure on 429 (rate limit)", async () => {
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 429,
        headers: { "retry-after": "30" },
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
    });

    it("does NOT call recordPlatformFailure on 401 (auth)", async () => {
      mockRefreshToken.mockResolvedValueOnce(false);
      spyNetRequest(requestor, async () => ({
        data: {},
        status: 401,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
    });

    it("calls recordPlatformFailure('twitch', 'net-error') on network error after retries exhausted", async () => {
      spyNetRequest(requestor, async () => {
        const err = new Error("fetch failed");
        throw err;
      });

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
    });

    it("calls recordPlatformFailure('twitch', 'timeout') on timeout error after retries exhausted", async () => {
      spyNetRequest(requestor, async () => {
        const err = new Error("timeout");
        throw err;
      });

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "timeout");
    });

    it("calls recordPlatformFailure('twitch', 'net-error') on ECONNRESET after retries exhausted", async () => {
      spyNetRequest(requestor, async () => {
        const err = new Error("connection reset");
        (err as any).cause = { code: "ECONNRESET" };
        throw err;
      });

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
    });

    it("calls recordPlatformFailure('twitch', 'net-error') on ssl error after retries exhausted", async () => {
      spyNetRequest(requestor, async () => {
        throw new Error("ssl handshake failed");
      });

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
    });

    it("does NOT call recordPlatformFailure on non-retryable 4xx errors (e.g. 400)", async () => {
      spyNetRequest(requestor, async () => ({
        data: { message: "Bad Request" },
        status: 400,
        headers: {},
      }));

      await expect(requestor.request("/streams")).rejects.toThrow();

      expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
    });

    it("records success, not failure, when retries eventually succeed", async () => {
      let callCount = 0;
      spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount <= 2) return { data: {}, status: 503, headers: {} };
        return { data: { ok: true }, status: 200, headers: {} };
      });

      await requestor.request("/streams");

      expect(mockRecordPlatformSuccess).toHaveBeenCalledWith("twitch");
      expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
    });
  });

  describe("isAuthenticated", () => {
    it("delegates to twitchAuthService.isAuthenticated", () => {
      mockIsAuthenticated.mockReturnValueOnce(true);
      expect(requestor.isAuthenticated()).toBe(true);

      mockIsAuthenticated.mockReturnValueOnce(false);
      expect(requestor.isAuthenticated()).toBe(false);
    });
  });

  describe("getAccessToken", () => {
    it("delegates to twitchAuthService.getAccessToken", () => {
      mockGetAccessToken.mockReturnValueOnce("abc-token");
      expect(requestor.getAccessToken()).toBe("abc-token");

      mockGetAccessToken.mockReturnValueOnce(null);
      expect(requestor.getAccessToken()).toBeNull();
    });
  });
});
