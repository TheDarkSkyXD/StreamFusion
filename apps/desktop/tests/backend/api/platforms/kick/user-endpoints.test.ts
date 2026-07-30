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
  getPublicChannelUserProfile,
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
    vi.restoreAllMocks();
  });

  describe("getUser", () => {
    it("delegates to kickAuthService.fetchCurrentUser", async () => {
      const mockUser = { id: 1, username: "TestUser" };
      vi.mocked(kickAuthService.fetchCurrentUser).mockResolvedValueOnce(mockUser as any);

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

  describe("getUsersById", () => {
    it("uses app auth when viewer is not authenticated", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });

      const result = await getUsersById(client, [1, 2, 3]);

      expect(result).toEqual([]);
      expect(client.request).toHaveBeenCalledWith("/users?id[]=1&id[]=2&id[]=3", undefined, "app");
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

      expect(client.request).toHaveBeenCalledWith("/users?id[]=1&id[]=2", undefined, "user");
      expect(result).toEqual(mockUsers);
    });

    it("deduplicates IDs before sending the request", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [{ user_id: 1, name: "User1" }] }),
      });

      await getUsersById(client, [1, 1, 1]);

      expect(client.request).toHaveBeenCalledWith("/users?id[]=1", undefined, "user");
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

  describe("getPublicChannelUserProfile", () => {
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
  });
});
