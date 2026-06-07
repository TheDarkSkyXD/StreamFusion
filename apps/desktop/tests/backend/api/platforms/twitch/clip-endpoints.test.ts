import { describe, expect, it, vi } from "vitest";

import { getClipsByBroadcaster } from "@/backend/api/platforms/twitch/endpoints/clip-endpoints";
import type { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

function makeClient(response: unknown): TwitchRequestor {
  return {
    request: vi.fn(async () => response),
  } as unknown as TwitchRequestor;
}

const CLIP = {
  id: "clip-1",
  url: "https://clips.twitch.tv/clip-1",
  embed_url: "https://clips.twitch.tv/embed/clip-1",
  broadcaster_id: "b1",
  broadcaster_name: "Streamer",
  creator_id: "c1",
  creator_name: "Clipper",
  video_id: "v1",
  game_id: "g1",
  language: "en",
  title: "Epic moment",
  view_count: 5000,
  created_at: "2026-01-01T00:00:00Z",
  thumbnail_url: "https://img.twitch.tv/clip-thumb.jpg",
  duration: 30,
  vod_offset: 120,
  is_featured: false,
};

describe("getClipsByBroadcaster", () => {
  it("returns clips with cursor when full page is returned", async () => {
    const clips = Array.from({ length: 20 }, (_, i) => ({ ...CLIP, id: `clip-${i}` }));
    const client = makeClient({
      data: clips,
      pagination: { cursor: "next-page" },
    });

    const result = await getClipsByBroadcaster(client, "b1");

    expect(result.data).toHaveLength(20);
    expect(result.cursor).toBe("next-page");
  });

  it("returns no cursor when partial page is returned", async () => {
    const client = makeClient({
      data: [CLIP],
      pagination: { cursor: "should-be-ignored" },
    });

    const result = await getClipsByBroadcaster(client, "b1");

    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBeUndefined();
  });

  it("respects custom first for cursor logic", async () => {
    const clips = Array.from({ length: 5 }, (_, i) => ({ ...CLIP, id: `clip-${i}` }));
    const client = makeClient({
      data: clips,
      pagination: { cursor: "more" },
    });

    const result = await getClipsByBroadcaster(client, "b1", { first: 5 });

    expect(result.cursor).toBe("more");
  });

  it("passes broadcaster_id and pagination params to request", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getClipsByBroadcaster(client, "b99", {
      first: 10,
      after: "cursor-abc",
    });

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const endpoint = requestMock.mock.calls[0][0] as string;
    expect(endpoint).toContain("broadcaster_id=b99");
    expect(endpoint).toContain("first=10");
    expect(endpoint).toContain("after=cursor-abc");
  });

  it("passes time range params when provided", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getClipsByBroadcaster(client, "b1", {
      started_at: "2026-01-01T00:00:00Z",
      ended_at: "2026-01-31T23:59:59Z",
    });

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("started_at=2026-01-01T00%3A00%3A00Z");
    expect(endpoint).toContain("ended_at=2026-01-31T23%3A59%3A59Z");
  });

  it("defaults first to 20", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await getClipsByBroadcaster(client, "b1");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("returns raw TwitchApiClip data without transformation", async () => {
    const client = makeClient({ data: [CLIP], pagination: {} });

    const result = await getClipsByBroadcaster(client, "b1");

    expect(result.data[0]).toEqual(CLIP);
  });
});
