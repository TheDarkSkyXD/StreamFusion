import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: kick-client.ts uses `require("electron")` (CJS)     *
 * inside function bodies for both net and session. vi.mock only       *
 * intercepts ESM imports, so we patch Module.prototype.require.       *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
const mockSessionFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
const rateLimitStore = vi.hoisted(() => ({ blockedUntil: undefined as number | undefined }));

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "electron") {
    return {
      net: { fetch: (...args: unknown[]) => mockFetch(...args) },
      session: {
        fromPartition: vi.fn(() => ({
          fetch: (...args: unknown[]) => mockSessionFetch(...args),
          setProxy: vi.fn().mockResolvedValue(undefined),
          closeAllConnections: vi.fn().mockResolvedValue(undefined),
        })),
      },
    };
  }
  return _origRequire.call(this, id);
};

vi.mock("@backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

vi.mock("@backend/api/unified/platform-health", () => ({
  isPlatformHealthy: vi.fn(() => true),
  recordPlatformLocalNetError: vi.fn(),
}));

vi.mock("@backend/auth/kick-auth", () => ({
  kickAuthService: {
    isAuthenticated: vi.fn(() => true),
    ensureValidToken: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn(() => "test-token"),
    refreshToken: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: {
    getKickApiRateLimitState: vi.fn(() =>
      rateLimitStore.blockedUntil === undefined
        ? undefined
        : { blockedUntil: rateLimitStore.blockedUntil }
    ),
    saveKickApiRateLimitState: vi.fn((state: { blockedUntil: number }) => {
      rateLimitStore.blockedUntil = state.blockedUntil;
    }),
    clearKickApiRateLimitState: vi.fn(() => {
      rateLimitStore.blockedUntil = undefined;
    }),
  },
}));

vi.mock("@shared/utils/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@backend/services/third-party-cookie-stripper", () => ({
  registerThirdPartyCookieStripper: vi.fn(),
  purgeStoredThirdPartyCookies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@backend/api/unified/registry", () => ({
  clients: { register: vi.fn() },
}));

vi.mock("@backend/api/platforms/kick/endpoints/category-endpoints", () => ({
  getTopCategories: vi.fn(),
  searchCategories: vi.fn(),
  getCategoryById: vi.fn(),
  getAllCategories: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  getChannel: vi.fn(),
  getChannelsBySlugs: vi.fn(),
  getChannelsByBroadcasterIds: vi.fn(),
  getPublicChannel: vi.fn(),
  acquireBrowserWindowSlot: vi.fn(),
  mapKickChatroomToSettings: vi.fn(),
}));

vi.mock("@shared/utils/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/clip-endpoints", () => ({
  getClipsByChannelSlug: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/follow-endpoints", () => ({
  getAllFollowedChannels: vi.fn().mockResolvedValue({ status: "ok", channels: [] }),
}));

vi.mock("@backend/api/platforms/kick/endpoints/search-endpoints", () => ({
  searchChannels: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  getStreamBySlug: vi.fn(),
  getStreamsByBroadcasterIds: vi.fn(),
  getPublicStreamBySlug: vi.fn(),
  getTopStreams: vi.fn(),
  getPublicTopStreams: vi.fn(),
  getStreamsByCategory: vi.fn(),
  getFollowedStreams: vi.fn(),
  rememberCategorySlug: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/user-endpoints", () => ({
  getUser: vi.fn(),
  getUsersById: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/video-endpoints", () => ({
  getVideosByChannelSlug: vi.fn(),
}));

import {
  isPlatformHealthy,
  recordPlatformLocalNetError,
} from "@backend/api/unified/platform-health";
import { kickAuthService } from "@backend/auth/kick-auth";
import { logger } from "@backend/logging/logger";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Guards: official Kick reads use bounded retries, response sizes, and caller cancellation.
// Guards: authentication refresh is attempted only once and updates the retried request.
// Guards: canceled Electron requests do not create outage signals or error-log noise.
describe("KickClient", () => {
  let kickClient: typeof import("@backend/api/platforms/kick/kick-client").kickClient;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockSessionFetch.mockReset();
    rateLimitStore.blockedUntil = undefined;
    vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickAuthService.getAccessToken).mockReturnValue("test-token");
    vi.mocked(kickAuthService.ensureValidToken).mockResolvedValue(true);
    vi.mocked(kickAuthService.refreshToken).mockResolvedValue(null);
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
    ({ kickClient } = await import("@backend/api/platforms/kick/kick-client"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("throws when default user-token auth is unavailable", async () => {
      vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(false);

      await expect(kickClient.request("/test")).rejects.toThrow("No Kick user token");
    });

    it("sends the user bearer directly to api.kick.com without a proxy header", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result: "ok" }));

      await kickClient.request("/test");

      // electronRequest calls net.fetch(url, { method, headers, body, signal })
      const fetchOptions = mockFetch.mock.calls[0][1] as Record<string, unknown>;
      const fetchHeaders = fetchOptions.headers as Record<string, string>;
      expect(fetchHeaders.Authorization).toBe("Bearer test-token");
      expect(fetchHeaders["X-StreamFusion-Auth"]).toBeUndefined();
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.kick.com/public/v1/test");
    });

    it("prepends baseUrl for relative endpoints", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      await kickClient.request("/test-endpoint");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(kickClient.baseUrl);
      expect(url).toContain("/test-endpoint");
    });

    it("uses the official Kick API base URL", async () => {
      expect(kickClient.baseUrl).toBe("https://api.kick.com/public/v1");
    });

    it("uses absolute URL for endpoints starting with http", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      await kickClient.request("https://custom.api.com/endpoint");

      expect(mockFetch.mock.calls[0][0]).toBe("https://custom.api.com/endpoint");
    });

    it("records a durable cooldown and does not amplify a 429 with a retry", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));

      await expect(kickClient.request("/rate-limited")).rejects.toMatchObject({ status: 429 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(rateLimitStore.blockedUntil).toBeGreaterThan(Date.now());
    });

    it("blocks a request after a simulated app restart while the cooldown is active", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(kickClient.request("/first-launch")).rejects.toMatchObject({ status: 429 });

      vi.resetModules();
      const restartedClient = (await import("@backend/api/platforms/kick/kick-client")).kickClient;

      await expect(restartedClient.request("/second-launch")).rejects.toMatchObject({
        status: 429,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on 502/503/504 server errors", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 502))
        .mockResolvedValueOnce(jsonResponse({ result: "recovered" }));

      const result = await kickClient.request("/server-error");

      expect(result).toEqual({ result: "recovered" });
    });

    it("retries a non-JSON 503 response instead of failing JSON parsing", async () => {
      mockFetch
        .mockResolvedValueOnce(new Response("service unavailable", { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ result: "recovered" }));

      await expect(kickClient.request("/server-error-text")).resolves.toEqual({
        result: "recovered",
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // Guards: transient HTTP 500 responses retry so Kick follow metadata batches survive brief upstream outages.
    it("retries a transient 500 server error", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 500))
        .mockResolvedValueOnce(jsonResponse({ result: "recovered" }));

      await expect(kickClient.request("/channels")).resolves.toEqual({ result: "recovered" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on 403 without retry", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 403));

      await expect(kickClient.request("/forbidden")).rejects.toThrow("403");
    });

    it("attempts one-shot refresh on 401", async () => {
      vi.mocked(kickAuthService.refreshToken).mockResolvedValueOnce({
        accessToken: "new-token",
      });

      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValueOnce(jsonResponse({ result: "refreshed" }));

      const result = await kickClient.request("/needs-refresh");

      expect(kickAuthService.refreshToken).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ result: "refreshed" });
    });

    it("throws on 401 when refresh fails", async () => {
      vi.mocked(kickAuthService.refreshToken).mockResolvedValueOnce(null);

      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      await expect(kickClient.request("/refresh-fail")).rejects.toThrow("401");
    });

    it("does not retry 401 more than once (guard against double-refresh)", async () => {
      vi.mocked(kickAuthService.refreshToken).mockReset().mockResolvedValue({
        accessToken: "new-token",
      });

      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValueOnce(jsonResponse({}, 401));

      await expect(kickClient.request("/double-401")).rejects.toThrow("401");
      // refreshToken is called once on the first 401, then on the second 401
      // retriedOn401 is already true so it skips refresh and throws.
      expect(vi.mocked(kickAuthService.refreshToken).mock.calls).toHaveLength(1);
    });

    it("records net::ERR_* network errors for health tracking", async () => {
      mockFetch.mockRejectedValueOnce(new Error("net::ERR_FAILED"));

      await expect(kickClient.request("/network-fail")).rejects.toThrow();

      expect(recordPlatformLocalNetError).toHaveBeenCalledWith("kick");
    });

    it("does not treat a canceled request as a Kick outage", async () => {
      mockFetch.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));

      await expect(kickClient.request("/navigation-canceled")).rejects.toThrow("net::ERR_ABORTED");

      expect(recordPlatformLocalNetError).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith("Kick:Client", "Kick API request canceled", {
        endpoint: "/navigation-canceled",
      });
      expect(logger.error).not.toHaveBeenCalledWith(
        "Kick:Client",
        "Kick API request failed",
        expect.anything()
      );
    });

    it("uses Retry-After for a durable cooldown with a safe minimum", async () => {
      const before = Date.now();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "3" }));

      await expect(kickClient.request("/retry-after")).rejects.toMatchObject({ status: 429 });
      expect(rateLimitStore.blockedUntil).toBeGreaterThanOrEqual(before + 60_000);
      expect(rateLimitStore.blockedUntil).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    it("honors a long Retry-After without holding the request open", async () => {
      const before = Date.now();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "600" }));

      await expect(kickClient.request("/retry-after")).rejects.toMatchObject({ status: 429 });
      expect(rateLimitStore.blockedUntil).toBeGreaterThanOrEqual(before + 600_000);
      expect(rateLimitStore.blockedUntil).toBeLessThanOrEqual(Date.now() + 600_000);
    });

    it("does not start a request after caller cancellation", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        kickClient.request("/cancelled", { signal: controller.signal })
      ).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("parses JSON response data", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ users: [{ id: 1, name: "Test" }] }));

      const result = await kickClient.request<{ users: Array<{ id: number; name: string }> }>(
        "/users"
      );

      expect(result.users).toHaveLength(1);
      expect(result.users[0].name).toBe("Test");
    });

    it("throws on unparseable JSON response", async () => {
      mockFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));

      await expect(kickClient.request("/bad-json")).rejects.toThrow(
        "Failed to parse Kick API JSON response"
      );
    });
  });

  describe("isAuthenticated", () => {
    it("delegates to kickAuthService.isAuthenticated", () => {
      vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(true);
      expect(kickClient.isAuthenticated()).toBe(true);

      vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(false);
      expect(kickClient.isAuthenticated()).toBe(false);
    });
  });

  describe("fetchImageBytes", () => {
    type BinaryRequest = (
      url: string,
      headers: Record<string, string>,
      timeoutMs?: number
    ) => Promise<{ buffer: Buffer; statusCode: number; contentType: string }>;
    function installBinaryRequestMock() {
      const mock = vi.fn<BinaryRequest>();
      if (!Reflect.set(kickClient, "electronRequestBinary", mock)) {
        throw new Error("Could not install the Kick binary-request test seam");
      }
      return mock;
    }
    it("returns bytes and content type from a successful image fetch", async () => {
      const fakeBytes = { buffer: Buffer.from([1, 2, 3]), contentType: "image/webp" };
      const spy = installBinaryRequestMock().mockResolvedValue({ ...fakeBytes, statusCode: 200 });

      const result = await kickClient.fetchImageBytes("https://files.kick.com/test.webp");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result!.contentType).toBe("image/webp");
    });

    it("returns null and negative-caches on HTTP 4xx errors", async () => {
      installBinaryRequestMock().mockRejectedValue(new Error("HTTP 403"));

      const result1 = await kickClient.fetchImageBytes("https://files.kick.com/denied.webp");
      expect(result1).toBeNull();

      const result2 = await kickClient.fetchImageBytes("https://files.kick.com/denied.webp");
      expect(result2).toBeNull();
    });

    it("shares in-flight promise for concurrent calls to the same URL", async () => {
      let resolveInner!: (value: {
        buffer: Buffer;
        statusCode: number;
        contentType: string;
      }) => void;
      const innerPromise = new Promise<{ buffer: Buffer; statusCode: number; contentType: string }>(
        (resolve) => {
          resolveInner = resolve;
        }
      );

      const binarySpy = installBinaryRequestMock().mockReturnValue(innerPromise);

      const p1 = kickClient.fetchImageBytes("https://files.kick.com/shared.webp");
      const p2 = kickClient.fetchImageBytes("https://files.kick.com/shared.webp");

      resolveInner({ buffer: Buffer.from([1]), contentType: "image/png", statusCode: 200 });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual(r2);
      expect(binarySpy).toHaveBeenCalledTimes(1);
    });

    it("records net::ERR_* errors for non-4xx image failures", async () => {
      installBinaryRequestMock().mockRejectedValue(new Error("net::ERR_FAILED"));

      await kickClient.fetchImageBytes("https://files.kick.com/transient.webp");

      expect(recordPlatformLocalNetError).toHaveBeenCalledWith("kick");
    });

    it("does not treat a canceled image request as a Kick outage", async () => {
      installBinaryRequestMock().mockRejectedValue(new Error("net::ERR_ABORTED"));

      await kickClient.fetchImageBytes("https://files.kick.com/canceled.webp");

      expect(recordPlatformLocalNetError).not.toHaveBeenCalled();
    });
  });

  describe("platform property", () => {
    it('has platform set to "kick"', () => {
      expect(kickClient.platform).toBe("kick");
    });
  });

  describe("delegation methods", () => {
    it("getUser delegates to UserEndpoints", async () => {
      const { getUser } = await import("@backend/api/platforms/kick/endpoints/user-endpoints");
      vi.mocked(getUser).mockResolvedValueOnce({
        id: 1,
        username: "test",
        slug: "test",
        profilePic: "",
        verified: false,
      });

      const result = await kickClient.getUser();

      expect(getUser).toHaveBeenCalled();
      expect(result).toEqual({
        id: 1,
        username: "test",
        slug: "test",
        profilePic: "",
        verified: false,
      });
    });

    it("getChannel delegates to ChannelEndpoints", async () => {
      const { getChannel } =
        await import("@backend/api/platforms/kick/endpoints/channel-endpoints");
      vi.mocked(getChannel).mockResolvedValueOnce({
        id: "100",
        platform: "kick",
        username: "test",
        displayName: "test",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      });

      const result = await kickClient.getChannel("test");

      expect(getChannel).toHaveBeenCalledWith(kickClient, "test");
    });

    it("getChannelsByBroadcasterIds delegates to ChannelEndpoints", async () => {
      const { getChannelsByBroadcasterIds } =
        await import("@backend/api/platforms/kick/endpoints/channel-endpoints");
      vi.mocked(getChannelsByBroadcasterIds).mockResolvedValueOnce([
        {
          id: "123",
          platform: "kick",
          username: "new-slug",
          displayName: "new-slug",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ]);

      const result = await kickClient.getChannelsByBroadcasterIds([123]);

      expect(getChannelsByBroadcasterIds).toHaveBeenCalledWith(kickClient, [123]);
      expect(result[0].username).toBe("new-slug");
    });

    it("getTopStreams delegates to StreamEndpoints and returns PageResult", async () => {
      const { getTopStreams } =
        await import("@backend/api/platforms/kick/endpoints/stream-endpoints");
      vi.mocked(getTopStreams).mockResolvedValueOnce({
        data: [
          {
            id: "s1",
            platform: "kick",
            channelId: "1",
            channelName: "test",
            channelDisplayName: "test",
            channelAvatar: "",
            title: "",
            viewerCount: 1,
            thumbnailUrl: "",
            isLive: true,
            startedAt: null,
            language: "en",
            tags: [],
          },
        ],
        cursor: "next",
      });

      const result = await kickClient.getTopStreams();

      expect(result.data).toHaveLength(1);
      expect(result.cursor).toBe("next");
    });

    it("getFollowedChannels returns channels from FollowEndpoints", async () => {
      const { getAllFollowedChannels } =
        await import("@backend/api/platforms/kick/endpoints/follow-endpoints");
      vi.mocked(getAllFollowedChannels).mockResolvedValueOnce({
        status: "ok",
        canPruneAbsent: true,
        channels: [
          {
            id: "1",
            platform: "kick",
            username: "followed",
            displayName: "followed",
            avatarUrl: "",
            isLive: false,
            isVerified: false,
            isPartner: false,
          },
        ],
      });

      const result = await kickClient.getFollowedChannels();

      expect(result.data).toHaveLength(1);
    });

    it("getFollowedChannels returns empty data on error", async () => {
      const { getAllFollowedChannels } =
        await import("@backend/api/platforms/kick/endpoints/follow-endpoints");
      vi.mocked(getAllFollowedChannels).mockResolvedValueOnce({
        status: "error",
        reason: "network-error",
      });

      const result = await kickClient.getFollowedChannels();

      expect(result.data).toEqual([]);
    });
  });
});
