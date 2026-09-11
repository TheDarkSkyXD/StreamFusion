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

const helixStream = {
  id: "helix-1",
  language: "en",
  thumbnail_url: "https://example.com/{width}x{height}.jpg",
  title: "Direct Twitch",
  type: "live",
  user_id: "u1",
  user_login: "alice",
  user_name: "Alice",
  viewer_count: 9,
};

describe("createDiscoveryRuntime", () => {
  it("reads Twitch directly when a user token is ready", async () => {
    const urls: string[] = [];
    const session = createDiscoveryRuntime({
      cache: memoryCache(),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ data: [helixStream] }), {
          status: 200,
        });
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
    expect(outcome.items[0]?.title).toBe("Direct Twitch");
    expect(urls[0]).toContain("api.twitch.tv/helix/streams");
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
});
