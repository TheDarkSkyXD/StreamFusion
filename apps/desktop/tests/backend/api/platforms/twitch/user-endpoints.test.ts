import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  getUser,
  getUsersById,
  getUsersByLogin,
  getFollowedChannels,
  getAllFollowedChannels,
  getFollowerCounts,
} from "@/backend/api/platforms/twitch/endpoints/user-endpoints";

import type { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

const API_USER = {
  id: "u1",
  login: "testuser",
  display_name: "TestUser",
  type: "" as const,
  broadcaster_type: "partner" as const,
  description: "A test user",
  profile_image_url: "https://img.twitch.tv/avatar.jpg",
  offline_image_url: "https://img.twitch.tv/offline.jpg",
  email: "test@test.com",
  created_at: "2020-01-01T00:00:00Z",
};

const FOLLOWED_CHANNEL = {
  broadcaster_id: "b1",
  broadcaster_login: "followed1",
  broadcaster_name: "Followed1",
  followed_at: "2025-01-01T00:00:00Z",
};

const CHANNEL_DATA = {
  broadcaster_id: "b1",
  broadcaster_login: "followed1",
  broadcaster_name: "Followed1",
  broadcaster_language: "en",
  game_id: "g1",
  game_name: "Just Chatting",
  title: "Live!",
  delay: 0,
  tags: [],
  content_classification_labels: [],
  is_branded_content: false,
};

function makeClient(responses: Record<string, unknown>): TwitchRequestor {
  return {
    request: vi.fn(async (endpoint: string) => {
      for (const [pattern, resp] of Object.entries(responses)) {
        if (endpoint.includes(pattern)) return resp;
      }
      return { data: [] };
    }),
  } as unknown as TwitchRequestor;
}

function makeThrowingClient(error: Error): TwitchRequestor {
  return {
    request: vi.fn(async () => {
      throw error;
    }),
  } as unknown as TwitchRequestor;
}

describe("getUser", () => {
  it("returns mapped TwitchUser on success", async () => {
    const client = makeClient({
      "/users": { data: [API_USER] },
    });

    const result = await getUser(client);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("u1");
    expect(result!.login).toBe("testuser");
    expect(result!.displayName).toBe("TestUser");
    expect(result!.profileImageUrl).toBe("https://img.twitch.tv/avatar.jpg");
    expect(result!.email).toBe("test@test.com");
    expect(result!.broadcasterType).toBe("partner");
  });

  it("returns null when data array is empty", async () => {
    const client = makeClient({ "/users": { data: [] } });

    const result = await getUser(client);

    expect(result).toBeNull();
  });

  it("returns null on request error", async () => {
    const client = makeThrowingClient(new Error("Network error"));

    const result = await getUser(client);

    expect(result).toBeNull();
  });
});

describe("getUsersById", () => {
  it("returns empty array for empty input", async () => {
    const client = makeClient({});
    const result = await getUsersById(client, []);
    expect(result).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("throws when more than 100 IDs provided", async () => {
    const client = makeClient({});
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);
    await expect(getUsersById(client, ids)).rejects.toThrow("Cannot fetch more than 100");
  });

  it("returns mapped users", async () => {
    const u2 = { ...API_USER, id: "u2", login: "user2", display_name: "User2" };
    const client = makeClient({
      "/users": { data: [API_USER, u2] },
    });

    const result = await getUsersById(client, ["u1", "u2"]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("u1");
    expect(result[1].id).toBe("u2");
    expect(result[0].login).toBe("testuser");
    expect(result[1].login).toBe("user2");
  });

  it("builds query string with multiple id params", async () => {
    const client = makeClient({ "/users": { data: [] } });

    await getUsersById(client, ["a", "b"]);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("id=a");
    expect(endpoint).toContain("id=b");
  });
});

describe("getUsersByLogin", () => {
  it("returns empty array for empty input", async () => {
    const client = makeClient({});
    const result = await getUsersByLogin(client, []);
    expect(result).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("throws when more than 100 logins provided", async () => {
    const client = makeClient({});
    const logins = Array.from({ length: 101 }, (_, i) => `login${i}`);
    await expect(getUsersByLogin(client, logins)).rejects.toThrow("Cannot fetch more than 100");
  });

  it("returns mapped users by login", async () => {
    const client = makeClient({
      "/users": { data: [API_USER] },
    });

    const result = await getUsersByLogin(client, ["testuser"]);

    expect(result).toHaveLength(1);
    expect(result[0].login).toBe("testuser");
  });

  it("builds query string with login params", async () => {
    const client = makeClient({ "/users": { data: [] } });

    await getUsersByLogin(client, ["alice", "bob"]);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("login=alice");
    expect(endpoint).toContain("login=bob");
  });
});

describe("getFollowedChannels", () => {
  it("throws when user is not authenticated", async () => {
    const client = makeClient({ "/users": { data: [] } });

    await expect(getFollowedChannels(client)).rejects.toThrow("Must be authenticated");
  });

  it("returns unified channels with cursor and total", async () => {
    const client = makeClient({
      "/users": { data: [API_USER] },
      "/channels/followed": {
        data: [FOLLOWED_CHANNEL],
        pagination: { cursor: "pg2" },
        total: 50,
      },
      "/channels": { data: [CHANNEL_DATA] },
    });

    const result = await getFollowedChannels(client);

    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBe("pg2");
    expect(result.total).toBe(50);
  });

  it("passes first and after options", async () => {
    const client = makeClient({
      "/users": { data: [API_USER] },
      "/channels/followed": { data: [], pagination: {} },
    });

    await getFollowedChannels(client, { first: 25, after: "abc" });

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const followedCall = requestMock.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("/channels/followed")
    );
    expect(followedCall).toBeDefined();
    const url = followedCall![0] as string;
    expect(url).toContain("first=25");
    expect(url).toContain("after=abc");
  });
});

describe("getAllFollowedChannels", () => {
  it("paginates until cursor is exhausted", async () => {
    let callCount = 0;
    const client = {
      request: vi.fn(async (endpoint: string) => {
        if (endpoint.includes("/users")) {
          return { data: [API_USER] };
        }
        if (endpoint.includes("/channels/followed")) {
          callCount++;
          if (callCount === 1) {
            return {
              data: [FOLLOWED_CHANNEL],
              pagination: { cursor: "pg2" },
            };
          }
          return { data: [], pagination: {} };
        }
        if (endpoint.includes("/channels")) {
          return { data: [CHANNEL_DATA] };
        }
        return { data: [] };
      }),
    } as unknown as TwitchRequestor;

    const result = await getAllFollowedChannels(client);

    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getFollowerCounts", () => {
  it("returns map of broadcaster IDs to follower counts", async () => {
    const client = makeClient({
      "broadcaster_id=b1": { total: 1000, data: [{}] },
      "broadcaster_id=b2": { total: 500, data: [{}] },
    });

    const result = await getFollowerCounts(client, ["b1", "b2"]);

    expect(result.get("b1")).toBe(1000);
    expect(result.get("b2")).toBe(500);
  });

  it("omits entries with auth failures (401)", async () => {
    let callCount = 0;
    const client = {
      request: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("Unauthorized") as Error & { status: number };
          err.status = 401;
          throw err;
        }
        return { total: 200, data: [{}] };
      }),
    } as unknown as TwitchRequestor;

    const result = await getFollowerCounts(client, ["fail", "ok"]);

    expect(result.has("fail")).toBe(false);
    expect(result.get("ok")).toBe(200);
  });

  it("returns empty map for empty input", async () => {
    const client = makeClient({});
    const result = await getFollowerCounts(client, []);
    expect(result.size).toBe(0);
  });

  it("processes in batches of 25", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `b${i}`);
    const client = {
      request: vi.fn(async () => ({ total: 10, data: [{}] })),
    } as unknown as TwitchRequestor;

    const result = await getFollowerCounts(client, ids);

    expect(result.size).toBe(30);
  });
});
