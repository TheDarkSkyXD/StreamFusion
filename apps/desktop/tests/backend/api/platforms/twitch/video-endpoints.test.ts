import { describe, expect, it, vi } from "vitest";

import {
  getVideosByGame,
  getVideosByUser,
  getVideoById,
} from "@backend/api/platforms/twitch/endpoints/video-endpoints";

import type { TwitchRequestor } from "@backend/api/platforms/twitch/twitch-requestor";

function makeClient(response: unknown): TwitchRequestor {
  return {
    request: vi.fn(async () => response),
  } as unknown as TwitchRequestor;
}

const VIDEO = {
  id: "v1",
  stream_id: "s1",
  user_id: "u1",
  user_login: "streamer",
  user_name: "Streamer",
  title: "Past Broadcast",
  description: "A VOD",
  created_at: "2026-01-01T00:00:00Z",
  published_at: "2026-01-01T00:00:00Z",
  url: "https://www.twitch.tv/videos/v1",
  thumbnail_url: "https://img.twitch.tv/%{width}x%{height}/thumb.jpg",
  viewable: "public" as const,
  view_count: 1234,
  language: "en",
  type: "archive" as const,
  duration: "3h8m32s",
  muted_segments: null,
};

describe("getVideosByUser", () => {
  it("returns videos with cursor when full page is returned", async () => {
    const videos = Array.from({ length: 20 }, (_, i) => ({ ...VIDEO, id: `v${i}` }));
    const client = makeClient({
      data: videos,
      pagination: { cursor: "next-page" },
    });

    const result = await getVideosByUser(client, "u1");

    expect(result.data).toHaveLength(20);
    expect(result.cursor).toBe("next-page");
  });

  it("returns no cursor when partial page is returned", async () => {
    const client = makeClient({
      data: [VIDEO],
      pagination: { cursor: "should-be-dropped" },
    });

    const result = await getVideosByUser(client, "u1");

    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBeUndefined();
  });

  it("respects custom first for cursor logic", async () => {
    const videos = Array.from({ length: 5 }, (_, i) => ({ ...VIDEO, id: `v${i}` }));
    const client = makeClient({
      data: videos,
      pagination: { cursor: "more" },
    });

    const result = await getVideosByUser(client, "u1", { first: 5 });

    expect(result.cursor).toBe("more");
  });

  it("passes user_id, first, after, and type params", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getVideosByUser(client, "u99", {
      first: 10,
      after: "cursor-abc",
      type: "highlight",
    });

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("user_id=u99");
    expect(endpoint).toContain("first=10");
    expect(endpoint).toContain("after=cursor-abc");
    expect(endpoint).toContain("type=highlight");
  });

  it("defaults first to 20", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getVideosByUser(client, "u1");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("does not include type when not specified", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getVideosByUser(client, "u1");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).not.toContain("type=");
  });

  it("returns raw TwitchApiVideo data without transformation", async () => {
    const client = makeClient({ data: [VIDEO], pagination: {} });

    const result = await getVideosByUser(client, "u1");

    expect(result.data[0]).toEqual(VIDEO);
  });
});

describe("getVideoById", () => {
  it("returns the video when found", async () => {
    const client = makeClient({ data: [VIDEO] });

    const result = await getVideoById(client, "v1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("v1");
    expect(result!.title).toBe("Past Broadcast");
  });

  it("returns null when no video found", async () => {
    const client = makeClient({ data: [] });

    const result = await getVideoById(client, "nonexistent");

    expect(result).toBeNull();
  });

  it("passes video ID in the query", async () => {
    const client = makeClient({ data: [] });

    await getVideoById(client, "v123");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("id=v123");
  });
});

// Guards: Category Video discovery uses Twitch's native game identity and forwards the selected global sort.
describe("getVideosByGame", () => {
  it("requests the native game feed with pagination and Views ordering", async () => {
    const client = makeClient({ data: [VIDEO], pagination: { cursor: "next-page" } });

    const result = await getVideosByGame(client, "509658", {
      first: 1,
      after: "cursor-abc",
      sort: "views",
    });

    expect(client.request).toHaveBeenCalledWith(
      "/videos?game_id=509658&first=1&after=cursor-abc&sort=views"
    );
    expect(result).toEqual({ data: [VIDEO], cursor: "next-page" });
  });
});
