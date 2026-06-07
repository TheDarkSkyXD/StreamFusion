import { describe, expect, it, vi } from "vitest";

import {
  searchCategories,
  searchChannels,
} from "@/backend/api/platforms/twitch/endpoints/search-endpoints";

import type { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

function makeClient(response: unknown): TwitchRequestor {
  return {
    request: vi.fn(async () => response),
  } as unknown as TwitchRequestor;
}

const SEARCH_CHANNEL = {
  broadcaster_language: "en",
  broadcaster_login: "founduser",
  display_name: "FoundUser",
  game_id: "g1",
  game_name: "Just Chatting",
  id: "sc1",
  is_live: true,
  tags: ["English"],
  thumbnail_url: "https://img.twitch.tv/thumb.jpg",
  title: "Streaming now",
  started_at: "2026-01-01T00:00:00Z",
};

const GAME = {
  id: "g1",
  name: "Just Chatting",
  box_art_url: "https://img.twitch.tv/{width}x{height}/jc.jpg",
};

describe("searchChannels", () => {
  it("returns unified channels with cursor", async () => {
    const client = makeClient({
      data: [SEARCH_CHANNEL],
      pagination: { cursor: "next" },
    });

    const result = await searchChannels(client, "found");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("sc1");
    expect(result.data[0].username).toBe("founduser");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.data[0].isLive).toBe(true);
    expect(result.cursor).toBe("next");
  });

  it("passes query, first, after, and liveOnly params", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await searchChannels(client, "test query", {
      first: 10,
      after: "cursor-x",
      liveOnly: true,
    });

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("query=test+query");
    expect(endpoint).toContain("first=10");
    expect(endpoint).toContain("after=cursor-x");
    expect(endpoint).toContain("live_only=true");
  });

  it("does not include live_only when not specified", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await searchChannels(client, "test");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).not.toContain("live_only");
  });

  it("defaults first to 20", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await searchChannels(client, "test");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("returns empty data on empty results", async () => {
    const client = makeClient({ data: [], pagination: {} });

    const result = await searchChannels(client, "nothing");

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });
});

describe("searchCategories", () => {
  it("returns transformed categories with cursor", async () => {
    const client = makeClient({
      data: [GAME],
      pagination: { cursor: "cat-next" },
    });

    const result = await searchCategories(client, "chatting");

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("g1");
    expect(result.data[0].name).toBe("Just Chatting");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.cursor).toBe("cat-next");
  });

  it("passes query, first, and after params", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await searchCategories(client, "fort", { first: 5, after: "pg2" });

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("query=fort");
    expect(endpoint).toContain("first=5");
    expect(endpoint).toContain("after=pg2");
  });

  it("defaults first to 20", async () => {
    const client = makeClient({ data: [], pagination: {} });

    await searchCategories(client, "test");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("replaces box_art_url dimensions in transformed output", async () => {
    const client = makeClient({ data: [GAME], pagination: {} });

    const result = await searchCategories(client, "chatting");

    expect(result.data[0].boxArtUrl).toBe("https://img.twitch.tv/285x380/jc.jpg");
  });
});
