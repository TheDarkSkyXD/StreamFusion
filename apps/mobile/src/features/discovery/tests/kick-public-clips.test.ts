import { describe, expect, it } from "vitest";
import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import { readKickPublicChannelClips } from "../adapters/kick/kick-public-clips";
import { createDiscoveryRuntime } from "../composition/discovery-runtime";

describe("Kick public channel clips", () => {
  it("reads published clips with public share URLs and a continuation cursor", async () => {
    const requested: string[] = [];
    const result = await readKickPublicChannelClips({
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(
          JSON.stringify({
            clips: [
              {
                id: "clip_123",
                title: "A good moment",
                duration: 27,
                views: 42,
                created_at: "2026-10-16T15:52:08.971671Z",
                video_url:
                  "https://clips.kick.com/clips/ab/clip_123/playlist.m3u8",
                thumbnail_url:
                  "https://clips.kick.com/clips/ab/clip_123/thumbnail.webp",
                creator: { username: "Viewer" },
                channel: { id: 668, slug: "xqc", username: "xQc" },
                category: { id: 8, name: "Grand Theft Auto V" },
              },
            ],
            nextCursor: "next-page",
          }),
          { status: 200 },
        );
      },
      slug: "xqc",
    });

    expect(requested).toEqual([
      "https://kick.com/api/v2/channels/xqc/clips?cursor=0&limit=20&sort=date",
    ]);
    expect(result.status).toBe("complete");
    expect(result.cursor).toBe("next-page");
    expect(result.items[0]).toEqual({
      id: "clip_123",
      platform: "kick",
      channelId: "668",
      channelName: "xqc",
      channelDisplayName: "xQc",
      channelAvatar: "",
      title: "A good moment",
      thumbnailUrl: "https://clips.kick.com/clips/ab/clip_123/thumbnail.webp",
      clipUrl: "https://kick.com/xqc/clips/clip_123",
      shareUrl: "https://kick.com/xqc/clips/clip_123",
      duration: 27,
      viewCount: 42,
      createdAt: "2026-10-16T15:52:08.971Z",
      creatorName: "Viewer",
      categoryId: "8",
      categoryName: "Grand Theft Auto V",
    });
  });

  it("shows Kick clips through the channel discovery session", async () => {
    const cache: DisposableCache = {
      clear: async () => {},
      get: async () => ({ kind: "miss" }),
      put: async () => {},
    };
    const session = createDiscoveryRuntime({
      cache,
      fetch: async () =>
        new Response(
          JSON.stringify({
            clips: [
              {
                id: "clip_123",
                title: "A good moment",
                duration: 27,
                created_at: "2026-10-16T15:52:08.971671Z",
                channel: { id: 668, slug: "xqc" },
              },
            ],
          }),
          { status: 200 },
        ),
      installation: { read: async () => ({ kind: "none" }) },
      kickAccessToken: async () => null,
      network: { read: async () => "online" },
      relayBaseUrl: "http://relay.test/",
      twitchClientId: null,
      userTokens: { read: async () => ({ kind: "none" }) },
    });

    const lane = await session.readChannelClips({
      channel: { id: "668", platform: "kick", username: "xqc" },
    });

    expect(lane.kind).toBe("page");
    if (lane.kind !== "page") return;
    expect(lane.outcome.status).toBe("complete");
    expect(lane.outcome.items[0]?.clipUrl).toBe(
      "https://kick.com/xqc/clips/clip_123",
    );
  });
});
