import { describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  getFollowedStreams,
  getStreamByLogin,
  getStreamsByUserIds,
  getTopStreams,
} from "@/backend/api/platforms/twitch/endpoints/stream-endpoints";

import type { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

const STREAM = {
  id: "s1",
  user_id: "u1",
  user_login: "streamer1",
  user_name: "Streamer1",
  game_id: "g1",
  game_name: "Just Chatting",
  type: "live" as const,
  title: "Hello!",
  viewer_count: 500,
  started_at: "2026-01-01T00:00:00Z",
  language: "en",
  thumbnail_url: "https://img.twitch.tv/{width}x{height}/thumb.jpg",
  tag_ids: [],
  tags: ["English"],
  is_mature: false,
};

const USER = {
  id: "u1",
  login: "streamer1",
  display_name: "Streamer1",
  type: "",
  broadcaster_type: "affiliate",
  description: "",
  profile_image_url: "https://img.twitch.tv/avatar.jpg",
  offline_image_url: "",
  email: "",
  created_at: "2020-01-01T00:00:00Z",
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

describe("getStreamsByUserIds", () => {
  it("returns empty array for empty input", async () => {
    const client = makeClient({});

    const result = await getStreamsByUserIds(client, []);

    expect(result.data).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("throws when more than 100 IDs are provided", async () => {
    const client = makeClient({});
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);

    await expect(getStreamsByUserIds(client, ids)).rejects.toThrow("Cannot fetch more than 100");
  });

  it("returns transformed streams with cursor", async () => {
    const client = makeClient({
      "/streams": { data: [STREAM], pagination: { cursor: "next" } },
      "/users": { data: [USER] },
    });

    const result = await getStreamsByUserIds(client, ["u1"]);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("s1");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.data[0].channelName).toBe("streamer1");
    expect(result.data[0].isLive).toBe(true);
    expect(result.cursor).toBe("next");
  });

  it("marks streams verified when the Twitch broadcaster is a partner", async () => {
    const client = makeClient({
      "/streams": { data: [STREAM], pagination: {} },
      "/users": { data: [{ ...USER, broadcaster_type: "partner" }] },
    });

    const result = await getStreamsByUserIds(client, ["u1"]);

    expect(result.data[0].channelIsVerified).toBe(true);
  });

  it("appends user_id params for each ID", async () => {
    const client = makeClient({
      "/streams": { data: [], pagination: {} },
    });

    await getStreamsByUserIds(client, ["u1", "u2", "u3"]);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("user_id=u1");
    expect(endpoint).toContain("user_id=u2");
    expect(endpoint).toContain("user_id=u3");
  });

  it("passes first and after params", async () => {
    const client = makeClient({
      "/streams": { data: [], pagination: {} },
    });

    await getStreamsByUserIds(client, ["u1"], { first: 50, after: "c2" });

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=50");
    expect(endpoint).toContain("after=c2");
  });

  it("defaults first to 100", async () => {
    const client = makeClient({
      "/streams": { data: [], pagination: {} },
    });

    await getStreamsByUserIds(client, ["u1"]);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=100");
  });
});

describe("getFollowedStreams", () => {
  it("throws when user is not authenticated", async () => {
    const client = makeClient({
      "/users": { data: [] },
    });

    await expect(getFollowedStreams(client)).rejects.toThrow("Must be authenticated");
  });

  it("returns transformed followed streams with cursor", async () => {
    const client = makeClient({
      "/users": { data: [USER] },
      "/streams/followed": { data: [STREAM], pagination: { cursor: "more" } },
    });

    const result = await getFollowedStreams(client);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].channelId).toBe("u1");
    expect(result.cursor).toBe("more");
  });

  it("passes user_id and pagination to request", async () => {
    const client = makeClient({
      "/users": { data: [USER] },
      "/streams/followed": { data: [], pagination: {} },
    });

    await getFollowedStreams(client, { first: 50, after: "pg2" });

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const followedEndpoint = requestMock.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("/streams/followed")
    );
    expect(followedEndpoint).toBeDefined();
    const url = followedEndpoint![0] as string;
    expect(url).toContain("user_id=u1");
    expect(url).toContain("first=50");
    expect(url).toContain("after=pg2");
  });
});

// Guards: malformed Helix stream rows fail at the endpoint boundary before transformation.
describe("getTopStreams", () => {
  it("rejects malformed stream rows", async () => {
    const client = makeClient({ "/streams": { data: [{ id: "missing-required-fields" }] } });

    await expect(getTopStreams(client)).rejects.toThrow();
  });

  it("returns transformed streams with user avatars", async () => {
    const client = makeClient({
      "/streams": { data: [STREAM], pagination: { cursor: "top-next" } },
      "/users": { data: [{ ...USER, profile_image_url: "https://avatar.url/pic.jpg" }] },
    });

    const result = await getTopStreams(client);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].channelAvatar).toBe("https://avatar.url/pic.jpg");
    expect(result.cursor).toBe("top-next");
  });

  it("passes game_id and language filters", async () => {
    const client = makeClient({
      "/streams": { data: [], pagination: {} },
      "/users": { data: [] },
    });

    await getTopStreams(client, { gameId: "g99", language: "fr" });

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const streamsCall = requestMock.mock.calls[0][0] as string;
    expect(streamsCall).toContain("game_id=g99");
    expect(streamsCall).toContain("language=fr");
  });

  it("defaults first to 20", async () => {
    const client = makeClient({
      "/streams": { data: [], pagination: {} },
      "/users": { data: [] },
    });

    await getTopStreams(client);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("preserves avatar as empty string when user not found", async () => {
    const client = makeClient({
      "/streams": { data: [STREAM], pagination: {} },
      "/users": { data: [] },
    });

    const result = await getTopStreams(client);

    expect(result.data[0].channelAvatar).toBe("");
  });
});

describe("getStreamByLogin", () => {
  it("returns the stream when found", async () => {
    const client = makeClient({
      "/streams": { data: [STREAM] },
    });

    const result = await getStreamByLogin(client, "streamer1");

    expect(result).not.toBeNull();
    expect(result!.channelName).toBe("streamer1");
  });

  it("returns null when no stream is found", async () => {
    const client = makeClient({
      "/streams": { data: [] },
    });

    const result = await getStreamByLogin(client, "offline_user");

    expect(result).toBeNull();
  });

  it("passes user_login in the query", async () => {
    const client = makeClient({
      "/streams": { data: [] },
    });

    await getStreamByLogin(client, "testlogin");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("user_login=testlogin");
  });
});
