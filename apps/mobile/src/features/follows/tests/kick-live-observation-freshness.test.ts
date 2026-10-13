import { describe, expect, it } from "vitest";

import { createKickLiveCatalog } from "@mobile/features/discovery/adapters/kick/kick-live-catalog";
import { createKickGuestFollowedContentReader } from "../adapters/kick/kick-guest-followed-content-reader";

describe("Kick notification observation freshness", () => {
  it("does not turn an older discovery cache into a new live observation", async () => {
    let now = 100;
    let live = true;
    const fetch: typeof globalThis.fetch = async (url) => {
      if (String(url).includes("/private/v1/livestreams")) {
        return new Response(
          JSON.stringify({
            data: {
              livestreams: live
                ? [
                    {
                      id: 100,
                      streamer: {
                        channel: { id: 42, slug: "example" },
                        user: { username: "Example" },
                      },
                      metadata: { title: "Earlier session" },
                    },
                  ]
                : [],
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({ id: 42, slug: "example", livestream: null }),
      );
    };
    const catalog = createKickLiveCatalog({ fetch, nowEpochMs: () => now });
    const discovery = await catalog.read({});
    expect(discovery.kind === "ready" && discovery.entries[0]?.stream.id).toBe(
      "100",
    );
    now = 210;
    live = false;
    const reader = createKickGuestFollowedContentReader({
      fetch,
      liveCatalog: catalog,
    });
    const observation = await reader.readStreams({
      platform: "kick",
      refs: [{ kind: "login", value: "example" }],
    });
    expect(observation.items).toEqual([]);
    expect(observation.verifiedOfflineChannelIds).toEqual(["42"]);
  });
});
