import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createRelaySuccessEnvelope } from "@streamfusion/core/relay";

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

  it("reads signed-out catalogs through Relay", async () => {
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async () =>
        new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                platform: "kick",
                streams: [fixtureStream("kick", "relay-1", 4)],
              },
              requestId: "req_signed_out_discovery_1",
            }),
          ),
          { status: 200 },
        ),
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.readTopStreams({ platform: "kick" });
    expect(outcome.path).toEqual({ kind: "relay", platform: "kick" });
    expect(outcome.items).toHaveLength(1);
  });

  it("returns a stale cache when Relay is down after a prior hit", async () => {
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

  it("retries a transient Relay failure once automatically", async () => {
    let calls = 0;
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        return new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                platform: "twitch",
                streams: [fixtureStream("twitch", "retry", 2)],
              },
              requestId: "req_signed_out_discovery_2",
            }),
          ),
          { status: 200 },
        );
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
  });

  it("reads a guest category page through Relay", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                category: {
                  boxArtUrl: "https://example.com/box.png",
                  id: "509658",
                  name: "Just Chatting",
                  platform: "twitch",
                },
                platform: "twitch",
              },
              requestId: "req_signed_out_category_1",
            }),
          ),
          { status: 200 },
        );
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
    expect(urls[0]).toContain("v1/discovery/category?");
    expect(urls[0]).toContain("categoryId=509658");
  });

  it("searches categories with the Relay q parameter", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                categories: [
                  {
                    boxArtUrl: "https://example.com/box.png",
                    id: "g1",
                    name: "Just Chatting",
                    platform: "twitch",
                  },
                ],
                channels: [],
                clips: [],
                platform: "twitch",
                query: "just chatting",
                streams: [],
                videos: [],
              },
              requestId: "req_signed_out_search_cat_1",
            }),
          ),
          { status: 200 },
        );
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
    expect(urls[0]).toContain("q=just+chatting");
    expect(urls[0]).not.toContain("query=");
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

  it("reads a signed-out channel through Relay and marks Kick media unsupported", async () => {
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/v1/discovery/channel?")) {
          return new Response(
            JSON.stringify(
              createRelaySuccessEnvelope({
                body: {
                  channel: {
                    avatarUrl: "https://example.com/a.png",
                    displayName: "Alice",
                    id: "c1",
                    isLive: false,
                    isPartner: false,
                    isVerified: false,
                    platform: "twitch",
                    username: "alice",
                  },
                  live: null,
                  platform: "twitch",
                },
                requestId: "req_channel_1",
              }),
            ),
            { status: 200 },
          );
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
    expect(page.path).toEqual({ kind: "relay", platform: "twitch" });
    const kickVideos = await session.readChannelVideos({
      channel: { id: "k1", platform: "kick", username: "kick-live" },
    });
    expect(kickVideos).toEqual({
      kind: "unsupported",
      media: "videos",
      platform: "kick",
    });
  });

  it("keeps guest Twitch search unavailable and tries Kick without a token", async () => {
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
    expect(twitch.path).toEqual({
      kind: "unavailable",
      platform: "twitch",
      reason: "guest-unavailable",
    });
    expect(kick.path).toEqual({ kind: "guest", platform: "kick" });
    expect(urls.some((url) => url.includes("api.kick.com"))).toBe(true);
    expect(urls.some((url) => url.includes("api.twitch.tv"))).toBe(false);
  });

  it("reads Relay search catalogs that include videos and clips", async () => {
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("query") ?? url.searchParams.get("q")).toBe(
          "arcade",
        );
        return new Response(
          JSON.stringify(
            createRelaySuccessEnvelope({
              body: {
                categories: [],
                channels: [],
                clips: [],
                platform: "twitch",
                query: "arcade",
                streams: [fixtureStream("twitch", "search-relay", 3)],
                videos: [],
              },
              requestId: "req_signed_out_search_3",
            }),
          ),
          { status: 200 },
        );
      },
      installation: { read: async () => ({ credential: "install", kind: "ready" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });
    const outcome = await session.search({ platform: "twitch", query: "arcade" });
    expect(outcome.path).toEqual({ kind: "relay", platform: "twitch" });
    expect(outcome.catalog.streams[0]?.id).toBe("search-relay");
  });
});
