import { describe, expect, it } from "vitest";

import {
  isValidUnifiedClip,
  sanitizeSearchResultCollection,
} from "@/search/search-result-validation";

const validClip = {
  id: "clip-1",
  platform: "twitch" as const,
  channelId: "channel-1",
  channelName: "streamer_university",
  channelDisplayName: "Streamer University",
  channelAvatar: "",
  title: "Campus moment",
  thumbnailUrl: "",
  clipUrl: "https://clips.twitch.tv/clip-1",
  embedUrl: "https://clips.twitch.tv/embed?clip=clip-1",
  duration: 30,
  viewCount: 1,
  createdAt: "2026-07-16T00:00:00.000Z",
  creatorName: "Curator",
};

describe("Clip search-result validation", () => {
  it("requires stable and navigation identities before caching or rendering", () => {
    expect(isValidUnifiedClip(validClip)).toBe(true);
    expect(isValidUnifiedClip({ ...validClip, id: "" })).toBe(false);
    expect(isValidUnifiedClip({ ...validClip, channelName: "" })).toBe(false);
    expect(isValidUnifiedClip({ ...validClip, clipUrl: undefined })).toBe(false);
    expect(isValidUnifiedClip({ ...validClip, createdAt: "invalid" })).toBe(false);
  });

  it("sanitizes malformed Clips and reports their rejected count", () => {
    const result = sanitizeSearchResultCollection({
      channels: [],
      categories: [],
      streams: [],
      videos: [],
      clips: [validClip, { ...validClip, id: "" }],
    });

    expect(result.data.clips).toEqual([validClip]);
    expect(result.rejectedClips).toBe(1);
  });
});
