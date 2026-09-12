import { describe, expect, it } from "vitest";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";
import { createDiscoveryCacheStore } from "../data/cache-discovery-store";
import { fixtureStream } from "../domain/discovery-fixture";

describe("discovery cache store", () => {
  it("round-trips top-stream pages and drops unknown payloads", async () => {
    const rows = new Map<string, string>();
    const cache: DisposableCache = {
      async clear() {
        rows.clear();
      },
      async get(key) {
        const payload = rows.get(key);
        return payload
          ? {
              ageMilliseconds: 10,
              kind: "hit",
              payload,
              stale: false,
            }
          : { kind: "miss" };
      },
      async put(options) {
        rows.set(options.key, options.payload);
      },
    };
    const store = createDiscoveryCacheStore(cache);
    await store.writeTopStreams({
      items: [fixtureStream("twitch", "cached", 5)],
      platform: "twitch",
    });
    await expect(store.readTopStreams("twitch")).resolves.toMatchObject({
      items: [{ id: "cached" }],
      kind: "hit",
    });
    await cache.put({
      key: "discovery:top-streams:kick:all",
      payload: "{not-json",
    });
    await expect(store.readTopStreams("kick")).resolves.toEqual({ kind: "miss" });
  });

  it("round-trips category catalog pages", async () => {
    const rows = new Map<string, string>();
    const cache: DisposableCache = {
      async clear() {
        rows.clear();
      },
      async get(key) {
        const payload = rows.get(key);
        return payload
          ? {
              ageMilliseconds: 10,
              kind: "hit",
              payload,
              stale: false,
            }
          : { kind: "miss" };
      },
      async put(options) {
        rows.set(options.key, options.payload);
      },
    };
    const store = createDiscoveryCacheStore(cache);
    await store.writeCategories({
      items: [
        {
          boxArtUrl: "https://example.com/box.png",
          id: "509658",
          name: "Just Chatting",
          platform: "twitch",
        },
      ],
      platform: "twitch",
    });
    await expect(store.readCategories("twitch")).resolves.toMatchObject({
      items: [{ id: "509658", name: "Just Chatting" }],
      kind: "hit",
    });
  });
});
