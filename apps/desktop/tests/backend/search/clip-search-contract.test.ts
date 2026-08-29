import { describe, expect, it } from "vitest";

import type { UnifiedClip } from "@shared/platform-types";
import {
  filterRankAndDeduplicateClips,
  rankClipMatch,
} from "@backend/search/search-match-contract";

function clip(overrides: Partial<UnifiedClip> = {}): UnifiedClip {
  return {
    id: "clip-1",
    platform: "twitch",
    channelId: "channel-1",
    channelName: "streamer_university",
    channelDisplayName: "Streamer University",
    channelAvatar: "",
    title: "Welcome to campus",
    thumbnailUrl: "",
    clipUrl: "https://clips.twitch.tv/clip-1",
    embedUrl: "https://clips.twitch.tv/embed?clip=clip-1",
    duration: 30,
    viewCount: 10,
    createdAt: "2026-07-16T00:00:00.000Z",
    creatorName: "Hidden Curator",
    ...overrides,
  };
}

describe("Clip search contract", () => {
  it("requires every token to match only the title or Channel identity", () => {
    expect(rankClipMatch(clip(), "streamer campus")).not.toBeNull();
    expect(rankClipMatch(clip({ creatorName: "secret launch" }), "secret launch")).toBeNull();
    expect(rankClipMatch(clip({ gameName: "Hidden Arena" }), "hidden arena")).toBeNull();
  });

  it("discovers Clips by username when the card displays another Channel name", () => {
    expect(
      rankClipMatch(clip({ channelDisplayName: "Campus Live" }), "streamer univer")
    ).not.toBeNull();
  });

  it("orders exact identity, prefix identity, then title with popularity and date ties", () => {
    const values = [
      clip({
        id: "older-title",
        channelName: "elsewhere",
        channelDisplayName: "Elsewhere",
        title: "streamer universe lesson",
        viewCount: 7,
        createdAt: "2026-07-15T00:00:00.000Z",
      }),
      clip({ id: "prefix", channelName: "streamer_universe_live", channelDisplayName: "Other" }),
      clip({ id: "exact", channelName: "streamer_universe", channelDisplayName: "Other" }),
      clip({
        id: "newer-title",
        channelName: "elsewhere",
        channelDisplayName: "Elsewhere",
        title: "streamer universe lesson",
        viewCount: 7,
        createdAt: "2026-07-16T00:00:00.000Z",
      }),
    ];

    expect(
      filterRankAndDeduplicateClips(values, "streamer universe").map((item) => item.id)
    ).toEqual(["exact", "prefix", "newer-title", "older-title"]);
  });
});
