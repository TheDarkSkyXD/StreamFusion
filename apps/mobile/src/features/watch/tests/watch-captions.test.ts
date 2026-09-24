import { describe, expect, it } from "vitest";

import {
  watchCaptionEligibility,
  watchCaptionSessionId,
} from "../domain/watch-captions";
import type { WatchTarget } from "../capabilities/watch";

const live: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

const video: WatchTarget = {
  ...live,
  media: {
    durationSeconds: 120,
    id: "vod-99",
    kind: "video",
    title: "VOD",
  },
};

describe("Watch caption eligibility", () => {
  it("hides player CC chrome for live streams until track-based CC ships", () => {
    expect(watchCaptionEligibility(live)).toEqual({ kind: "hidden" });
    expect(watchCaptionSessionId(live)).toBeNull();
  });

  it("hides captions on Videos and Clips", () => {
    expect(watchCaptionEligibility(video)).toEqual({ kind: "hidden" });
    expect(watchCaptionSessionId(video)).toBeNull();
  });

  it("stays hidden when Settings turns captions off", () => {
    expect(watchCaptionEligibility(live, false)).toEqual({ kind: "hidden" });
  });
});
