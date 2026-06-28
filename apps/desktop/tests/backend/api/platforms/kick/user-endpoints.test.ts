import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cross-logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/auth/kick-auth", () => ({
  kickAuthService: {
    fetchCurrentUser: vi.fn(),
  },
}));

import { getUser, getUsersById } from "@/backend/api/platforms/kick/endpoints/user-endpoints";
import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";
import { kickAuthService } from "@/backend/auth/kick-auth";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

describe("user-endpoints", () => {
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

    it("fetches users by IDs with correct query format", async () => {
      const mockUsers = [
        { user_id: 1, name: "User1", profile_picture: null },
        { user_id: 2, name: "User2", profile_picture: "https://example.com/2.webp" },
      ];
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: mockUsers }),
      });

      const result = await getUsersById(client, [1, 2]);

      expect(client.request).toHaveBeenCalledWith("/users?id[]=1&id[]=2", undefined, "app");
      expect(result).toEqual(mockUsers);
    });

    it("deduplicates IDs before sending the request", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [{ user_id: 1, name: "User1" }] }),
      });

      await getUsersById(client, [1, 1, 1]);

      expect(client.request).toHaveBeenCalledWith("/users?id[]=1", undefined, "app");
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
  });
});
