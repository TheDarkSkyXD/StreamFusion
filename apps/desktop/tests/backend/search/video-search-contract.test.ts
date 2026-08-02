import { describe, expect, it } from "vitest";

import type { UnifiedVideo } from "@/backend/api/unified/platform-types";
import {
  filterRankAndDeduplicateVideos,
  rankVideoMatch,
} from "@/backend/search/search-match-contract";

function video(overrides: Partial<UnifiedVideo> = {}): UnifiedVideo {
  return {
    id: "v1",
    platform: "twitch",
    channelId: "c1",
    channelName: "streamer_university",
    channelDisplayName: "Streamer University",
    channelAvatar: "",
    title: "Welcome to campus",
    thumbnailUrl: "",
    duration: 120,
    viewCount: 10,
    publishedAt: "2026-07-16T00:00:00.000Z",
    url: "https://www.twitch.tv/videos/v1",
    type: "archive",
    ...overrides,
  };
}

describe("Video search contract", () => {
  it("requires every token to match only title or Channel identity", () => {
    expect(rankVideoMatch(video(), "streamer campus")).not.toBeNull();
    expect(rankVideoMatch(video({ description: "secret launch" }), "secret launch")).toBeNull();
    expect(rankVideoMatch(video({ gameName: "Hidden Arena" }), "hidden arena")).toBeNull();
  });

  it("discovers Videos by username even when the card displays a different name", () => {
    expect(rankVideoMatch(video({ channelDisplayName: "Campus Live" }), "streamer univer")).not.toBeNull();
  });

  it("ranks an exact title as a tier-zero primary match", () => {
    expect(rankVideoMatch(video({ channelName: "elsewhere", channelDisplayName: "Elsewhere", title: "Campus News" }), "campus news")).toEqual({ tier: 0, editDistance: 0 });
  });

  it("supports one-edit identity matching and uses date after equal popularity", () => {
    expect(
      rankVideoMatch(
        video({ channelName: "streamer_university", channelDisplayName: "Campus" }),
        "stremaer university"
      )
    ).toEqual({ tier: 2, editDistance: 1 });
    const older = video({ id: "older", channelName: "elsewhere", channelDisplayName: "Elsewhere", title: "streamer universe lesson", viewCount: 7, publishedAt: "2026-07-15T00:00:00.000Z" });
    const newer = video({ id: "newer", channelName: "elsewhere", channelDisplayName: "Elsewhere", title: "streamer universe lesson", viewCount: 7, publishedAt: "2026-07-16T00:00:00.000Z" });
    expect(filterRankAndDeduplicateVideos([older, newer], "streamer universe").map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("orders exact identity, identity prefix, fuzzy identity, then title with date/popularity ties", () => {
    const values = [
      video({ id: "popular-title", channelName: "elsewhere", channelDisplayName: "Elsewhere", title: "streamer universe lessons", viewCount: 10 }),
      video({ id: "prefix", channelName: "streamer_universe_live", channelDisplayName: "Other" }),
      video({ id: "exact", channelName: "streamer_universe", channelDisplayName: "Other" }),
      video({ id: "newer-title", channelName: "elsewhere", channelDisplayName: "Elsewhere", title: "streamer universe campus", publishedAt: "2026-07-17T00:00:00.000Z", viewCount: 1 }),
    ];

    expect(filterRankAndDeduplicateVideos(values, "streamer universe").map((item) => item.id)).toEqual([
      "exact",
      "prefix",
      "popular-title",
      "newer-title",
    ]);
  });
});
