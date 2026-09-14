import { describe, expect, it } from "vitest";

import { recordedWatchStartPositionMs } from "../domain/watch-target";

// Guards: recorded Start watching begins at 0 so History can store in-progress Resume
// Guards: Resume still seeks to the saved position after Start

describe("recorded watch start position", () => {
  it("starts live playback without a seek", () => {
    expect(
      recordedWatchStartPositionMs({
        channelId: "1",
        channelName: "xqc",
        platform: "twitch",
      }),
    ).toBeNull();
  });

  it("starts recordings at 0 unless Resume supplied a position", () => {
    expect(
      recordedWatchStartPositionMs({
        channelId: "1",
        channelName: "xqc",
        platform: "twitch",
        media: {
          durationSeconds: 6671,
          id: "vod-1",
          kind: "video",
          title: "Yesterday",
        },
      }),
    ).toBe(0);
    expect(
      recordedWatchStartPositionMs({
        channelId: "1",
        channelName: "xqc",
        platform: "twitch",
        media: {
          durationSeconds: 6671,
          id: "vod-1",
          kind: "video",
          resumePositionSeconds: 40,
          title: "Yesterday",
        },
      }),
    ).toBe(40_000);
  });
});
