import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: kick-client.ts uses `require("electron")` (CJS)     *
 * inside function bodies for both net and session. vi.mock only       *
 * intercepts ESM imports, so we patch Module.prototype.require.       *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();
const mockSessionFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
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
  return _origRequire.apply(this, [id] as any);
};

vi.mock("@/backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

vi.mock("@/backend/api/unified/platform-health", () => ({
  isPlatformHealthy: vi.fn(() => true),
  recordPlatformLocalNetError: vi.fn(),
  recordPlatformOfficialApiAuthFailure: vi.fn(),
}));

vi.mock("@/backend/auth/kick-auth", () => ({
  kickAuthService: {
    isAuthenticated: vi.fn(() => true),
    ensureValidToken: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn(() => "test-token"),
    refreshToken: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/backend/services/third-party-cookie-stripper", () => ({
  registerThirdPartyCookieStripper: vi.fn(),
  purgeStoredThirdPartyCookies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/api/unified/registry", () => ({
  clients: { register: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/endpoints/category-endpoints", () => ({
  getTopCategories: vi.fn(),
  searchCategories: vi.fn(),
  getCategoryById: vi.fn(),
  getAllCategories: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  getChannel: vi.fn(),
  getChannelsBySlugs: vi.fn(),
  getChannelsByBroadcasterIds: vi.fn(),
  getPublicChannel: vi.fn(),
  acquireBrowserWindowSlot: vi.fn(),
  mapKickChatroomToSettings: vi.fn(),
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/clip-endpoints", () => ({
  getClipsByChannelSlug: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/follow-endpoints", () => ({
  getAllFollowedChannels: vi.fn().mockResolvedValue({ status: "ok", channels: [] }),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/search-endpoints", () => ({
  searchChannels: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  getStreamBySlug: vi.fn(),
  getStreamsByBroadcasterIds: vi.fn(),
  getPublicStreamBySlug: vi.fn(),
  getTopStreams: vi.fn(),
  getPublicTopStreams: vi.fn(),
  getStreamsByCategory: vi.fn(),
  getFollowedStreams: vi.fn(),
  rememberCategorySlug: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/user-endpoints", () => ({
  getUser: vi.fn(),
  getUsersById: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/video-endpoints", () => ({
  getVideosByChannelSlug: vi.fn(),
}));

import {
  isPlatformHealthy,
  recordPlatformLocalNetError,
  recordPlatformOfficialApiAuthFailure,
} from "@/backend/api/unified/platform-health";
import { kickAuthService } from "@/backend/auth/kick-auth";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("KickClient", () => {
  let kickClient: typeof import("@/backend/api/platforms/kick/kick-client").kickClient;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockSessionFetch.mockReset();
    vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(true);
    vi.mocked(kickAuthService.getAccessToken).mockReturnValue("test-token");
    vi.mocked(kickAuthService.ensureValidToken).mockResolvedValue(true);
    vi.mocked(kickAuthService.refreshToken).mockResolvedValue(null);
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
    ({ kickClient } = await import("@/backend/api/platforms/kick/kick-client"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("throws when default user-token auth is unavailable", async () => {
      vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(false);

      await expect(kickClient.request("/test")).rejects.toThrow("No Kick user token");
    });

    it("uses an app token when the caller explicitly requests app auth", async () => {
      vi.mocked(kickAuthService.isAuthenticated).mockReturnValue(false);
      mockFetch.mockResolvedValueOnce(jsonResponse({ result: "ok" }));

      await kickClient.request("/channels?broadcaster_user_id[]=123", undefined, "app");

      const fetchOptions = mockFetch.mock.calls[0][1] as Record<string, unknown>;
      const fetchHeaders = fetchOptions.headers as Record<string, string>;
      expect(fetchHeaders.Authorization).toBeUndefined();
      expect(fetchHeaders["X-StreamFusion-Auth"]).toBe("app");
    });

    it("marks Kick degraded when the Worker app-token proxy returns 401", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      await expect(
        kickClient.request("/channels?slug[]=hennytingzz", undefined, "app")
      ).rejects.toThrow("401");

      expect(recordPlatformOfficialApiAuthFailure).toHaveBeenCalledWith("kick", 401);
      expect(kickAuthService.refreshToken).not.toHaveBeenCalled();
    });

    // Guards: anonymous Kick successes must not immediately re-enable a Worker app-token proxy that returned 401.
    it("keeps the app-token proxy cooling down when shared Kick health recovers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      await expect(
        kickClient.request("/channels?slug[]=first-probe", undefined, "app")
      ).rejects.toThrow("401");

      vi.mocked(isPlatformHealthy).mockReturnValue(true);

      await expect(
        kickClient.request("/channels?slug[]=fallback-metadata", undefined, "app")
      ).rejects.toThrow("Kick official API app-token proxy unavailable while Kick is degraded");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Guards: a failed app-token recovery probe must re-arm cooldown so fallback callers do not probe repeatedly.
    it("re-arms the app-token cooldown when its recovery probe fails", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      await expect(
        kickClient.request("/channels?slug[]=initial-probe", undefined, "app")
      ).rejects.toThrow("401");

      now.mockReturnValue(301_001);
      mockFetch.mockRejectedValueOnce(new Error("net::ERR_FAILED"));
      await expect(
        kickClient.request("/channels?slug[]=failed-recovery", undefined, "app")
      ).rejects.toThrow("net::ERR_FAILED");

      await expect(
        kickClient.request("/channels?slug[]=fallback-after-failure", undefined, "app")
      ).rejects.toThrow("Kick official API app-token proxy unavailable while Kick is degraded");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // Guards: cooldown expiry permits one Worker recovery probe while concurrent callers keep using fallbacks.
    it("allows only one app-token recovery probe after cooldown expires", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(
        kickClient.request("/channels?slug[]=initial-probe", undefined, "app")
      ).rejects.toThrow("401");

      now.mockReturnValue(301_001);
      let resolveRecovery!: (response: Response) => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRecovery = resolve;
          })
      );

      const recovery = kickClient.request("/channels?slug[]=recovery", undefined, "app");
      await expect(
        kickClient.request("/channels?slug[]=concurrent-fallback", undefined, "app")
      ).rejects.toThrow("Kick official API app-token proxy unavailable while Kick is degraded");

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      resolveRecovery(jsonResponse({ data: [{ slug: "recovered" }] }));
      await expect(recovery).resolves.toEqual({ data: [{ slug: "recovered" }] });

      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await expect(
        kickClient.request("/channels?slug[]=after-recovery", undefined, "app")
      ).resolves.toEqual({ data: [] });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does not retry the app-token proxy while Kick is already degraded", async () => {
      vi.mocked(isPlatformHealthy).mockReturnValue(false);

      await expect(
        kickClient.request("/channels?slug[]=already-degraded", undefined, "app")
      ).rejects.toThrow("Kick official API app-token proxy unavailable while Kick is degraded");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(recordPlatformOfficialApiAuthFailure).not.toHaveBeenCalled();
    });

    it("sends Authorization header with Bearer token", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result: "ok" }));

      await kickClient.request("/test");

      // electronRequest calls net.fetch(url, { method, headers, body, signal })
      const fetchOptions = mockFetch.mock.calls[0][1] as Record<string, unknown>;
      const fetchHeaders = fetchOptions.headers as Record<string, string>;
      expect(fetchHeaders.Authorization).toBe("Bearer test-token");
    });

    it("prepends baseUrl for relative endpoints", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      await kickClient.request("/test-endpoint");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(kickClient.baseUrl);
      expect(url).toContain("/test-endpoint");
    });

    it("builds official API URLs from the shared Worker base URL", async () => {
      expect(kickClient.baseUrl).toBe("https://streamfusion.leveluptogetherbiz.workers.dev/kick");
    });

    it("uses absolute URL for endpoints starting with http", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      await kickClient.request("https://custom.api.com/endpoint");

      expect(mockFetch.mock.calls[0][0]).toBe("https://custom.api.com/endpoint");
    });

    it("retries on 429 with exponential backoff", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({ result: "ok" }));

      const result = await kickClient.request("/rate-limited");

      expect(result).toEqual({ result: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries on persistent 429", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({}, 429));

      await expect(kickClient.request("/always-429")).rejects.toThrow("429");
    });

    it("retries on 502/503/504 server errors", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 502))
        .mockResolvedValueOnce(jsonResponse({ result: "recovered" }));

      const result = await kickClient.request("/server-error");

      expect(result).toEqual({ result: "recovered" });
    });

    it("throws on 403 without retry", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 403));

      await expect(kickClient.request("/forbidden")).rejects.toThrow("403");
    });

    it("attempts one-shot refresh on 401", async () => {
      vi.mocked(kickAuthService.refreshToken).mockResolvedValueOnce({
        accessToken: "new-token",
      } as any);

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
      vi.mocked(kickAuthService.refreshToken)
        .mockReset()
        .mockResolvedValue({
          accessToken: "new-token",
        } as any);

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

    it("uses Retry-After header for 429 backoff when available", async () => {
      const { sleep } = await import("@/lib/sleep");

      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "3" }))
        .mockResolvedValueOnce(jsonResponse({ result: "ok" }));

      await kickClient.request("/retry-after");

      expect(sleep).toHaveBeenCalledWith(3000);
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

      await expect(kickClient.request("/bad-json")).rejects.toThrow("Failed to parse JSON");
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
    it("returns bytes and content type from a successful image fetch", async () => {
      const fakeBytes = { buffer: Buffer.from([1, 2, 3]), contentType: "image/webp" };
      const spy = vi
        .spyOn(kickClient as any, "electronRequestBinary")
        .mockResolvedValue({ ...fakeBytes, statusCode: 200 });

      const result = await kickClient.fetchImageBytes("https://files.kick.com/test.webp");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result!.contentType).toBe("image/webp");
    });

    it("returns null and negative-caches on HTTP 4xx errors", async () => {
      vi.spyOn(kickClient as any, "electronRequestBinary").mockRejectedValue(new Error("HTTP 403"));

      const result1 = await kickClient.fetchImageBytes("https://files.kick.com/denied.webp");
      expect(result1).toBeNull();

      const result2 = await kickClient.fetchImageBytes("https://files.kick.com/denied.webp");
      expect(result2).toBeNull();
    });

    it("shares in-flight promise for concurrent calls to the same URL", async () => {
      let resolveInner!: (value: unknown) => void;
      const innerPromise = new Promise((resolve) => {
        resolveInner = resolve;
      });

      vi.spyOn(kickClient as any, "electronRequestBinary").mockReturnValue(innerPromise);

      const p1 = kickClient.fetchImageBytes("https://files.kick.com/shared.webp");
      const p2 = kickClient.fetchImageBytes("https://files.kick.com/shared.webp");

      resolveInner({ buffer: Buffer.from([1]), contentType: "image/png", statusCode: 200 });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual(r2);
      expect(vi.spyOn(kickClient as any, "electronRequestBinary")).toHaveBeenCalledTimes(1);
    });

    it("records net::ERR_* errors for non-4xx image failures", async () => {
      vi.spyOn(kickClient as any, "electronRequestBinary").mockRejectedValue(
        new Error("net::ERR_FAILED")
      );

      await kickClient.fetchImageBytes("https://files.kick.com/transient.webp");

      expect(recordPlatformLocalNetError).toHaveBeenCalledWith("kick");
    });
  });

  describe("platform property", () => {
    it('has platform set to "kick"', () => {
      expect(kickClient.platform).toBe("kick");
    });
  });

  describe("delegation methods", () => {
    it("getUser delegates to UserEndpoints", async () => {
      const { getUser } = await import("@/backend/api/platforms/kick/endpoints/user-endpoints");
      vi.mocked(getUser).mockResolvedValueOnce({ id: "1", username: "test" } as any);

      const result = await kickClient.getUser();

      expect(getUser).toHaveBeenCalled();
      expect(result).toEqual({ id: "1", username: "test" });
    });

    it("getChannel delegates to ChannelEndpoints", async () => {
      const { getChannel } = await import(
        "@/backend/api/platforms/kick/endpoints/channel-endpoints"
      );
      vi.mocked(getChannel).mockResolvedValueOnce({
        id: "100",
        platform: "kick",
        username: "test",
      } as any);

      const result = await kickClient.getChannel("test");

      expect(getChannel).toHaveBeenCalledWith(kickClient, "test");
    });

    it("getChannelsByBroadcasterIds delegates to ChannelEndpoints", async () => {
      const { getChannelsByBroadcasterIds } = await import(
        "@/backend/api/platforms/kick/endpoints/channel-endpoints"
      );
      vi.mocked(getChannelsByBroadcasterIds).mockResolvedValueOnce([
        {
          id: "123",
          platform: "kick",
          username: "new-slug",
        },
      ] as any);

      const result = await kickClient.getChannelsByBroadcasterIds([123]);

      expect(getChannelsByBroadcasterIds).toHaveBeenCalledWith(kickClient, [123]);
      expect(result[0].username).toBe("new-slug");
    });

    it("getTopStreams delegates to StreamEndpoints and returns PageResult", async () => {
      const { getTopStreams } = await import(
        "@/backend/api/platforms/kick/endpoints/stream-endpoints"
      );
      vi.mocked(getTopStreams).mockResolvedValueOnce({
        data: [{ id: "s1" }] as any[],
        cursor: "next",
      });

      const result = await kickClient.getTopStreams();

      expect(result.data).toHaveLength(1);
      expect(result.cursor).toBe("next");
    });

    it("getFollowedChannels returns channels from FollowEndpoints", async () => {
      const { getAllFollowedChannels } = await import(
        "@/backend/api/platforms/kick/endpoints/follow-endpoints"
      );
      vi.mocked(getAllFollowedChannels).mockResolvedValueOnce({
        status: "ok",
        canPruneAbsent: true,
        channels: [{ id: "1", username: "followed" }] as any[],
      });

      const result = await kickClient.getFollowedChannels();

      expect(result.data).toHaveLength(1);
    });

    it("getFollowedChannels returns empty data on error", async () => {
      const { getAllFollowedChannels } = await import(
        "@/backend/api/platforms/kick/endpoints/follow-endpoints"
      );
      vi.mocked(getAllFollowedChannels).mockResolvedValueOnce({
        status: "error",
        reason: "network-error",
      } as any);

      const result = await kickClient.getFollowedChannels();

      expect(result.data).toEqual([]);
    });
  });
});
