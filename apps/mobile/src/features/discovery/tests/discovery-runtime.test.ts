import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";
import { createDiscoveryRuntime } from "../composition/discovery-runtime";
import { topStreamsQueryKey } from "../components/use-home-live-discovery";
import { fixtureStream } from "../domain/discovery-fixture";

function memoryCache(): DisposableCache {
  const rows = new Map<
    string,
    { freshness: number; payload: string; storedAt: number }
  >();
  return {
    async clear() {
      rows.clear();
    },
    async get(key) {
      const row = rows.get(key);
      if (!row) return { kind: "miss" };
      const ageMilliseconds = Date.now() - row.storedAt;
      return {
        ageMilliseconds,
        kind: "hit",
        payload: row.payload,
        stale: ageMilliseconds > row.freshness,
      };
    },
    async put(options) {
      rows.set(options.key, {
        freshness: options.freshnessMilliseconds ?? 300_000,
        payload: options.payload,
        storedAt: Date.now(),
      });
    },
  };
}

describe("createDiscoveryRuntime", () => {
  it("uses Helix for Home when a user token is present", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "guest-1",
                language: "en",
                thumbnail_url: "https://example.com/{width}x{height}.jpg",
                title: "Live",
                type: "live",
                user_id: "c1",
                user_login: "alice",
                user_name: "Alice",
                viewer_count: 5,
              },
            ],
          }),
          { status: 200 },
        );
      },
      installation: { read: async () => ({ kind: "none" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: "client",
      userTokens: {
        read: async (platform) =>
          platform === "twitch"
            ? { accessToken: "user", kind: "ready" }
            : { kind: "none" },
      },
    });
    const outcome = await session.readTopStreams({ platform: "twitch" });
    expect(outcome.path).toEqual({ kind: "direct", platform: "twitch" });
    expect(outcome.items[0]?.id).toBe("guest-1");
    expect(urls[0]).toContain("api.twitch.tv");
    expect(urls[0]).not.toContain("/v1/discovery/top-streams");
  });

  it("reads signed-out catalogs from public Kick even when an installation exists", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse([
          {
            channel: { id: 10, slug: "absi", user: { username: "Absi" } },
            id: 1,
            session_title: "Live",
            viewer_count: 4,
          },
        ]);
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.readTopStreams({ platform: "kick" });
    expect(outcome.path).toEqual({ kind: "guest", platform: "kick" });
    expect(outcome.items[0]?.channelName).toBe("absi");
    expect(urls[0]).toContain("kick.com/stream/featured-livestreams");
    expect(urls.some((url) => url.includes("relay.test"))).toBe(false);
  });

  it("returns a stale cache when guest public reads fail after a prior hit", async () => {
    const cache = memoryCache();
    await cache.put({
      freshnessMilliseconds: 1,
      key: "discovery:top-streams:twitch:all",
      payload: JSON.stringify({
        items: [fixtureStream("twitch", "cached", 3)],
      }),
    });
    const session = createDiscoveryRuntime({
      cache,
      fetch: async () => {
        throw new Error("offline");
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const outcome = await session.readTopStreams({ platform: "twitch" });
    expect(outcome.status).toBe("stale");
    expect(outcome.cache.kind).toBe("hit");
    expect(outcome.items[0]?.id).toBe("cached");
  });

  it("retries a transient guest failure once automatically", async () => {
    let calls = 0;
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        return jsonResponse(gqlTopStreams("retry"));
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.readTopStreams({ platform: "twitch" });
    expect(calls).toBe(2);
    expect(outcome.status).toBe("complete");
    expect(outcome.items[0]?.id).toBe("retry");
  });

  it("reads a guest category page through Twitch GQL", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse({
          data: {
            game: {
              boxArtURL: "https://example.com/box.png",
              displayName: "Just Chatting",
              id: "509658",
              name: "Just Chatting",
              slug: "just-chatting",
            },
          },
        });
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.readCategory({
      categoryId: "509658",
      platform: "twitch",
    });
    expect(outcome.status).toBe("complete");
    expect(outcome.items[0]?.name).toBe("Just Chatting");
    expect(urls[0]).toContain("gql.twitch.tv");
  });

  it("filters guest category search against public Twitch games", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse({
          data: {
            games: {
              edges: [
                {
                  node: {
                    boxArtURL: "https://example.com/box.png",
                    displayName: "Just Chatting",
                    id: "g1",
                    name: "Just Chatting",
                  },
                },
              ],
            },
          },
        });
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.searchCategories({
      platform: "twitch",
      query: "just chatting",
    });
    expect(outcome.items[0]?.id).toBe("g1");
    expect(urls[0]).toContain("gql.twitch.tv");
  });

  it("returns typed Kick clip and video gaps without fetching", async () => {
    let calls = 0;
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async () => {
        calls += 1;
        throw new Error("should not fetch");
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    await expect(
      session.readCategoryClips({
        categoryId: "15",
        platform: "kick",
        timeRange: "all",
      }),
    ).resolves.toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-clips-unsupported",
    });
    await expect(
      session.readCategoryVideos({
        categoryId: "15",
        platform: "kick",
        sort: "recent",
      }),
    ).resolves.toEqual({
      kind: "unsupported",
      platform: "kick",
      reason: "kick-videos-unsupported",
    });
    expect(calls).toBe(0);
  });

  it("invalidates only one platform query key", async () => {
    const reads: string[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const read = async (platform: "kick" | "twitch") => {
      reads.push(platform);
      return fixtureStream(platform, platform, 1);
    };
    await client.fetchQuery({
      queryFn: () => read("twitch"),
      queryKey: topStreamsQueryKey("twitch"),
    });
    await client.fetchQuery({
      queryFn: () => read("kick"),
      queryKey: topStreamsQueryKey("kick"),
    });
    reads.length = 0;
    await client.refetchQueries({ queryKey: ["discovery", "top-streams", "twitch"] });
    expect(reads).toEqual(["twitch"]);
  });

  it("reads a signed-out channel through Twitch GQL and Kick public videos", async () => {
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("gql.twitch.tv")) {
          return jsonResponse({
            data: {
              user: {
                displayName: "Alice",
                id: "c1",
                login: "alice",
                profileImageURL: "https://example.com/a.png",
              },
            },
          });
        }
        if (url.includes("kick.com/api/v2/channels/kick-live/videos")) {
          return jsonResponse([
            {
              created_at: "2026-09-01T00:00:00.000Z",
              duration: 12_000,
              id: 7,
              session_title: "Kick archive",
              source: "https://stream.kick.com/video.m3u8",
              thumbnail: { src: "" },
              views: 3,
              video: { uuid: "u" },
            },
          ]);
        }
        throw new Error(url);
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const page = await session.readChannel({
      channel: { id: "c1", platform: "twitch", username: "alice" },
    });
    expect(page.channel?.username).toBe("alice");
    expect(page.path).toEqual({ kind: "guest", platform: "twitch" });
    const kickVideos = await session.readChannelVideos({
      channel: { id: "k1", platform: "kick", username: "kick-live" },
    });
    expect(kickVideos.kind).toBe("page");
    if (kickVideos.kind !== "page") return;
    expect(kickVideos.outcome.status).toBe("complete");
    expect(kickVideos.outcome.items[0]).toMatchObject({
      duration: 12,
      id: "7",
      title: "Kick archive",
    });
    const kickClips = await session.readChannelClips({
      channel: { id: "k1", platform: "kick", username: "kick-live" },
    });
    expect(kickClips).toEqual({
      kind: "unsupported",
      media: "clips",
      platform: "kick",
    });
  });

  it("reads signed-out search from public Kick and Twitch GQL", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
      installation: { read: async () => ({ kind: "none" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const twitch = await session.search({ platform: "twitch", query: "arcade" });
    const kick = await session.search({ platform: "kick", query: "arcade" });
    expect(twitch.path).toEqual({ kind: "guest", platform: "twitch" });
    expect(kick.path).toEqual({ kind: "guest", platform: "kick" });
    expect(urls.some((url) => url.includes("kick.com"))).toBe(true);
    expect(urls.some((url) => url.includes("gql.twitch.tv"))).toBe(true);
    expect(urls.some((url) => url.includes("api.twitch.tv"))).toBe(false);
  });

  it("reads signed-out search from Twitch GQL even when an installation exists", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse({
          data: {
            games: { edges: [] },
            user: {
              displayName: "Arcade",
              id: "search-1",
              login: "arcade",
              profileImageURL: "https://example.com/a.png",
              stream: { id: "live-1" },
            },
          },
        });
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.search({ platform: "twitch", query: "arcade" });
    expect(outcome.path).toEqual({ kind: "guest", platform: "twitch" });
    expect(outcome.catalog.channels[0]?.username).toBe("arcade");
    expect(urls.every((url) => url.includes("gql.twitch.tv"))).toBe(true);
    expect(urls.some((url) => url.includes("relay.test"))).toBe(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function gqlTopStreams(id: string) {
  return {
    data: {
      streams: {
        edges: [
          {
            node: {
              broadcaster: {
                displayName: "Alice",
                id: "c1",
                login: "alice",
                profileImageURL: "",
              },
              game: { id: "1", name: "Game" },
              id,
              previewImageURL: "",
              title: "Live",
              viewersCount: 2,
            },
          },
        ],
      },
    },
  };
}
