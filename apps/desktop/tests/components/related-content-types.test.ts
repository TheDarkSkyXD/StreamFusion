import { describe, expect, it } from "vitest";

import {
  parsePlaybackQualities,
  parseVideoOrClips,
} from "@/components/stream/related-content/types";

const validMediaRow = {
  id: "clip-1",
  title: "A clip",
  duration: "0:30",
  views: "12",
  date: "2026-08-13T00:00:00.000Z",
  thumbnailUrl: "https://example.test/clip.jpg",
};

// Guards: malformed media rows crossing IPC must be discarded before renderer state treats them as playable content
describe("parseVideoOrClips", () => {
  it("retains media rows that satisfy the renderer contract", () => {
    expect(parseVideoOrClips([validMediaRow])).toEqual([validMediaRow]);
  });

  it("rejects malformed IPC rows instead of treating them as typed media", () => {
    expect(
      parseVideoOrClips([
        validMediaRow,
        null,
        { ...validMediaRow, id: 42 },
        { ...validMediaRow, thumbnailUrl: undefined },
        { ...validMediaRow, tags: ["gaming", 42] },
        { ...validMediaRow, platform: "youtube" },
        { ...validMediaRow, channelFollowerCount: "many" },
      ])
    ).toEqual([validMediaRow]);
  });

  it("returns an empty list for a non-array IPC payload", () => {
    expect(parseVideoOrClips({ data: [validMediaRow] })).toEqual([]);
  });

  it("retains only complete playback qualities from an IPC response", () => {
    expect(
      parsePlaybackQualities({
        qualities: [
          { quality: "720p", url: "https://example.test/720.m3u8" },
          { quality: "audio", url: null },
        ],
      })
    ).toEqual([{ quality: "720p", url: "https://example.test/720.m3u8" }]);
  });
});
