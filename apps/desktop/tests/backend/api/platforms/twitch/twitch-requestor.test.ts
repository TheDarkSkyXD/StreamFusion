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

type NetRequest = (
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ data: unknown | null; status: number; headers: Record<string, string> }>;
function spyNetRequest(requestor: TwitchRequestor, impl: NetRequest) {
  const mock = vi.fn<NetRequest>(impl);
  if (!Reflect.set(requestor, "netRequest", mock)) {
    throw new Error("Could not install the Twitch network-request test seam");
  }
  return mock;
}

// Guards: authenticated Helix calls go directly from Electron main to Twitch with main-owned credentials.
// Guards: transient HTTP 500 responses retry so followed-channel pagination survives brief Twitch outages.
// Guards: decoded Helix calls reject response shapes that do not satisfy their endpoint contract.
// Guards: empty Helix responses remain distinct from JSON objects.
// Guards: caller cancellation stops immediately and authentication refresh is attempted at most once.
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
    it("validates JSON through the endpoint decoder", async () => {
      spyNetRequest(requestor, async () => ({
        data: { unexpected: true },
        status: 200,
        headers: {},
      }));

      const decode = (value: unknown): { data: unknown[] } => {
        if (
          typeof value !== "object" ||
          value === null ||
          !("data" in value) ||
          !Array.isArray(value.data)
        ) {
          throw new Error("Invalid streams response");
        }
        return { data: value.data };
      };

      await expect(requestor.requestDecoded("/streams", decode)).rejects.toThrow(
        "Invalid streams response"
      );
    });

    it("accepts only null as an empty response", async () => {
      spyNetRequest(requestor, async () => ({ data: null, status: 204, headers: {} }));
      await expect(
        requestor.requestEmpty("/channels/followed", { method: "DELETE" })
      ).resolves.toBeUndefined();
    });

    it("calls Twitch Helix directly with main-owned credentials", async () => {
      const spy = spyNetRequest(requestor, async () => ({
        data: { ok: true },
        status: 200,
        headers: {},
      }));

      const result = await requestor.request("/streams");

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, opts] = spy.mock.calls[0];
      if (!opts?.headers) throw new Error("Expected request headers");
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

      const [, opts] = spy.mock.calls[0];
      if (!opts?.headers) throw new Error("Expected request headers");
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
      mockGetValidAccessToken
        .mockResolvedValueOnce("expired-token")
        .mockResolvedValueOnce("refreshed-token");
      let callCount = 0;
      const spy = spyNetRequest(requestor, async () => {
        callCount++;
        if (callCount === 1) return { data: {}, status: 401, headers: {} };
        return { data: { ok: true }, status: 200, headers: {} };
      });

      const result = await requestor.request("/streams");

      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[1]?.[1]?.headers?.Authorization).toBe("Bearer refreshed-token");
      expect(result).toEqual({ ok: true });
    });

    it("does not recurse or refresh twice when the refreshed token is also rejected", async () => {
      mockRefreshToken.mockResolvedValueOnce(true);
      const spy = spyNetRequest(requestor, async () => ({ data: {}, status: 401, headers: {} }));

      await expect(requestor.request("/streams")).rejects.toThrow("Authentication failed");
      expect(mockRefreshToken).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("does not retry a caller-aborted request", async () => {
      const controller = new AbortController();
      controller.abort();
      const spy = spyNetRequest(requestor, async () => ({ data: {}, status: 200, headers: {} }));

      await expect(requestor.request("/streams", { signal: controller.signal })).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
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

    it("retries a non-JSON 503 response instead of misclassifying it as a parse failure", async () => {
      const { net } = await import("electron");
      vi.mocked(net.fetch)
        .mockResolvedValueOnce(
          new Response("<html>temporarily unavailable</html>", { status: 503 })
        )
        .mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));

      await expect(requestor.request("/streams")).resolves.toEqual({ data: [] });
      expect(net.fetch).toHaveBeenCalledTimes(2);
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
          Object.defineProperty(err, "cause", { value: { code: "ECONNRESET" } });
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

      const [, opts] = spy.mock.calls[0];
      if (!opts) throw new Error("Expected request options");
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
        Object.defineProperty(err, "cause", { value: { code: "ECONNRESET" } });
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
