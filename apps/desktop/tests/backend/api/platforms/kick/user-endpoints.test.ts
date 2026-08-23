import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  loadURL: vi.fn(),
  executeJavaScript: vi.fn(),
  destroy: vi.fn(),
  releaseSlot: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return {
      loadURL: electronMocks.loadURL,
      webContents: { executeJavaScript: electronMocks.executeJavaScript },
      isDestroyed: () => false,
      destroy: electronMocks.destroy,
    };
  }),
}));

vi.mock("@/lib/cross-logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/auth/kick-auth", () => ({
  kickAuthService: {
    fetchCurrentUser: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  acquireBrowserWindowSlot: vi.fn(async () => electronMocks.releaseSlot),
}));

vi.mock("@/backend/api/unified/platform-health", () => ({
  getPlatformHealth: vi.fn(() => "healthy"),
}));

import {
  getChannelUserState,
  getPublicChannelUserProfile,
  getPublicChannelUserProfiles,
  getUser,
  getUsersById,
} from "@/backend/api/platforms/kick/endpoints/user-endpoints";
import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";
import { kickAuthService } from "@/backend/auth/kick-auth";
import { logger } from "@/lib/cross-logger";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

describe("user-endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.loadURL.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getUser", () => {
    it("delegates to kickAuthService.fetchCurrentUser", async () => {
      const mockUser = {
        id: 1,
        username: "TestUser",
        slug: "testuser",
        profilePic: "",
        verified: false,
      };
      vi.mocked(kickAuthService.fetchCurrentUser).mockResolvedValueOnce(mockUser);

      const result = await getUser();

      expect(kickAuthService.fetchCurrentUser).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockUser);
    });

    it("returns null when fetchCurrentUser returns null", async () => {
      vi.mocked(kickAuthService.fetchCurrentUser).mockResolvedValueOnce(null);

      const result = await getUser();

      expect(result).toBeNull();
    });
  });

  // Guards: Kick user ID filters use the OpenAPI repeated query parameter so profile metadata resolves for the requested broadcasters.
  // Guards: Kick profile enrichment chunks more than 50 requested users instead of losing names and avatars for large Following lists.
  // Guards: Kick user enrichment rejects profiles whose IDs were not requested.
  describe("getUsersById", () => {
    it("uses app auth when viewer is not authenticated", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });

      const result = await getUsersById(client, [1, 2, 3]);

      expect(result).toEqual([]);
      expect(client.request).toHaveBeenCalledWith("/users?id=1&id=2&id=3", undefined, "app");
    });

    it("returns empty array when ids list is empty", async () => {
      const client = createMockClient();

      const result = await getUsersById(client, []);

      expect(result).toEqual([]);
      expect(client.request).not.toHaveBeenCalled();
    });

    it("uses user auth for user enrichment when the viewer is authenticated", async () => {
      const mockUsers = [
        { user_id: 1, name: "User1", profile_picture: null },
        { user_id: 2, name: "User2", profile_picture: "https://example.com/2.webp" },
      ];
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: mockUsers }),
      });

      const result = await getUsersById(client, [1, 2]);

      expect(client.request).toHaveBeenCalledWith("/users?id=1&id=2", undefined, "user");
      expect(result).toEqual(mockUsers);
    });

    it("deduplicates IDs before sending the request", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [{ user_id: 1, name: "User1" }] }),
      });

      await getUsersById(client, [1, 1, 1]);

      expect(client.request).toHaveBeenCalledWith("/users?id=1", undefined, "user");
    });

    it("chunks a 108-channel Following profile request at the official 50-ID limit", async () => {
      const ids = Array.from({ length: 108 }, (_, index) => index + 1);
      const users = ids.map((userId) => ({
        user_id: userId,
        name: `User${userId}`,
        profile_picture: `https://example.com/${userId}.webp`,
      }));
      const client = createMockClient({
        request: vi
          .fn()
          .mockResolvedValueOnce({ data: users.slice(0, 50) })
          .mockResolvedValueOnce({ data: users.slice(50, 100) })
          .mockResolvedValueOnce({ data: users.slice(100) }),
      });

      const result = await getUsersById(client, ids);

      expect(client.request).toHaveBeenCalledTimes(3);
      expect(client.request).toHaveBeenNthCalledWith(
        1,
        `/users?${ids
          .slice(0, 50)
          .map((id) => `id=${id}`)
          .join("&")}`,
        undefined,
        "user"
      );
      expect(client.request).toHaveBeenNthCalledWith(
        2,
        `/users?${ids
          .slice(50, 100)
          .map((id) => `id=${id}`)
          .join("&")}`,
        undefined,
        "user"
      );
      expect(client.request).toHaveBeenNthCalledWith(
        3,
        `/users?${ids
          .slice(100)
          .map((id) => `id=${id}`)
          .join("&")}`,
        undefined,
        "user"
      );
      expect(result).toEqual(users);
    });

    it("rejects user profiles whose IDs were not requested", async () => {
      const requestedUser = { user_id: 1, name: "Requested", profile_picture: null };
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            { user_id: 999, name: "SignedInSubstitution", profile_picture: null },
            requestedUser,
          ],
        }),
      });

      const result = await getUsersById(client, [1]);

      expect(result).toEqual([requestedUser]);
    });

    it("returns empty array when response.data is null", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: null }),
      });

      const result = await getUsersById(client, [1]);

      expect(result).toEqual([]);
    });

    it("returns empty array and does not throw on request failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("Kick API error: 500")),
      });

      const result = await getUsersById(client, [1, 2]);

      expect(result).toEqual([]);
    });

    it("logs an expected official API circuit-open failure at debug level", async () => {
      const error = new Error(
        "Kick official API app-token proxy unavailable while Kick is degraded"
      );
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockRejectedValueOnce(error),
      });

      const result = await getUsersById(client, [1]);

      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(
        "Kick:Endpoints:User",
        "Failed to fetch Kick users",
        expect.objectContaining({ error: expect.objectContaining({ message: error.message }) })
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // Guards: explicit null following_since survives normalization distinctly from absent or malformed relationship data.
  describe("getPublicChannelUserProfile", () => {
    it("reuses one hidden window per 25-profile chunk", async () => {
      electronMocks.executeJavaScript.mockImplementation(async (script: string) => {
        const slugs = [...script.matchAll(/channel-(\d+)/g)].map((match) => match[0]);
        return JSON.stringify(
          [...new Set(slugs)].map((slug) => ({
            channelSlug: slug,
            payload: {
              id: 123,
              slug: "viewer",
              username: "Viewer",
              following_since: null,
            },
          }))
        );
      });

      const result = await getPublicChannelUserProfiles(
        Array.from({ length: 30 }, (_, index) => ({
          channelSlug: `channel-${index}`,
          username: "viewer",
        }))
      );

      expect(result).toHaveLength(30);
      expect(electronMocks.loadURL).toHaveBeenCalledTimes(2);
      expect(electronMocks.executeJavaScript).toHaveBeenCalledTimes(2);
      expect(electronMocks.releaseSlot).toHaveBeenCalledTimes(2);
    });

    it("limits in-window profile requests to two at a time", async () => {
      let active = 0;
      let peak = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          return new Response(
            JSON.stringify({
              id: 123,
              slug: "viewer",
              username: "Viewer",
              following_since: null,
            })
          );
        })
      );
      electronMocks.executeJavaScript.mockImplementation((script: string) =>
        globalThis.eval(script)
      );

      await getPublicChannelUserProfiles(
        Array.from({ length: 12 }, (_, index) => ({
          channelSlug: `channel-${index}`,
          username: "viewer",
        }))
      );

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(2);
    });

    it("honors Retry-After before retrying a rate-limited profile request", async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 123,
              slug: "viewer",
              username: "Viewer",
              following_since: "2026-01-01T00:00:00Z",
            })
          )
        );
      vi.stubGlobal("fetch", fetchMock);
      electronMocks.executeJavaScript.mockImplementation((script: string) =>
        globalThis.eval(script)
      );

      const pending = getPublicChannelUserProfiles([
        { channelSlug: "streamer", username: "viewer" },
      ]);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual([
        {
          channelSlug: "streamer",
          profile: expect.objectContaining({ followingSince: "2026-01-01T00:00:00Z" }),
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("releases the shared window slot when batch navigation never settles", async () => {
      vi.useFakeTimers();
      electronMocks.loadURL.mockReturnValue(new Promise(() => {}));

      const pending = getPublicChannelUserProfiles([
        { channelSlug: "streamer", username: "viewer" },
      ]);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toEqual([{ channelSlug: "streamer", profile: null }]);
      expect(electronMocks.destroy).toHaveBeenCalledOnce();
      expect(electronMocks.releaseSlot).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it("releases the shared window slot when batch execution never settles", async () => {
      vi.useFakeTimers();
      electronMocks.executeJavaScript.mockReturnValue(new Promise(() => {}));

      const pending = getPublicChannelUserProfiles([
        { channelSlug: "streamer", username: "viewer" },
      ]);
      await vi.advanceTimersByTimeAsync(75_000);

      await expect(pending).resolves.toEqual([{ channelSlug: "streamer", profile: null }]);
      expect(electronMocks.destroy).toHaveBeenCalledOnce();
      expect(electronMocks.releaseSlot).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it("rejects first-party schema drift instead of inventing identity from the request", async () => {
      electronMocks.executeJavaScript.mockResolvedValue(
        JSON.stringify({
          profile_pic: "https://files.kick.com/alice.webp",
          following_since: "2020-01-01T00:00:00Z",
        })
      );

      await expect(getPublicChannelUserProfile("streamer", "alice")).resolves.toBeNull();
    });

    it("retains only strict exact ISO follow timestamps", async () => {
      electronMocks.executeJavaScript
        .mockResolvedValueOnce(
          JSON.stringify({
            id: 123,
            slug: "alice",
            username: "Alice",
            following_since: "1",
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            id: 123,
            slug: "alice",
            username: "Alice",
            following_since: "2024-05-01T12:30:00Z",
          })
        );

      await expect(getPublicChannelUserProfile("streamer", "alice")).resolves.toMatchObject({
        userId: "123",
        username: "alice",
        followingSince: undefined,
      });
      await expect(getPublicChannelUserProfile("streamer", "alice")).resolves.toMatchObject({
        followingSince: "2024-05-01T12:30:00Z",
      });
    });

    it("preserves an explicit null follow relationship distinctly from a missing field", async () => {
      electronMocks.executeJavaScript
        .mockResolvedValueOnce(
          JSON.stringify({
            id: 123,
            slug: "alice",
            username: "Alice",
            following_since: null,
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            id: 123,
            slug: "alice",
            username: "Alice",
          })
        );

      await expect(getPublicChannelUserProfile("streamer", "alice")).resolves.toMatchObject({
        followingSince: null,
      });
      await expect(getPublicChannelUserProfile("streamer", "alice")).resolves.toMatchObject({
        followingSince: undefined,
      });
    });
  });

  describe("getChannelUserState", () => {
    it("returns normalized moderation state from the exact captured channel-user contract", async () => {
      electronMocks.executeJavaScript.mockResolvedValue(
        JSON.stringify({
          badges: [],
          badges_v2: [],
          banned: null,
          created_at: "2013-06-01T12:30:00Z",
          following_since: "2020-01-01T00:00:00Z",
          id: 123,
          is_channel_owner: false,
          is_moderator: true,
          is_staff: false,
          profile_pic: "https://files.kick.com/alice.webp",
          slug: "alice",
          subscribed_for: 0,
          username: "Alice",
        })
      );

      await expect(getChannelUserState("streamer", "alice")).resolves.toEqual({
        userId: "123",
        login: "alice",
        displayName: "Alice",
        isModerator: true,
        isChannelOwner: false,
        isStaff: false,
        banned: null,
      });
    });

    it("rejects missing, extra, and failed channel-user payloads", async () => {
      const captured = {
        badges: [],
        badges_v2: [],
        banned: null,
        created_at: "2013-06-01T12:30:00Z",
        following_since: null,
        id: 123,
        is_channel_owner: false,
        is_moderator: false,
        is_staff: false,
        profile_pic: null,
        slug: "alice",
        subscribed_for: 0,
        username: "Alice",
      };
      const { badges_v2: _missing, ...missingKey } = captured;

      electronMocks.executeJavaScript
        .mockResolvedValueOnce(JSON.stringify(missingKey))
        .mockResolvedValueOnce(JSON.stringify({ ...captured, unexpected: true }))
        .mockRejectedValueOnce(new Error("Kick unavailable"));

      await expect(getChannelUserState("streamer", "alice")).resolves.toBeNull();
      await expect(getChannelUserState("streamer", "alice")).resolves.toBeNull();
      await expect(getChannelUserState("streamer", "alice")).resolves.toBeNull();
    });
  });
});
