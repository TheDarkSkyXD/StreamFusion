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
  it("requires an actual native player session", () => {
    expect(watchCaptionEligibility(live).kind).toBe("unsupported");
    expect(watchCaptionSessionId(live)).toBeNull();
    expect(watchCaptionEligibility(live, true, "actual-player-7")).toEqual({
      kind: "eligible",
      label: "Local captions",
      sessionId: "actual-player-7",
    });
  });

  it("uses native program audio for recorded video without deriving a different session id", () => {
    expect(watchCaptionSessionId(video, "native-vod-99")).toBe("native-vod-99");
  });

  it("stays hidden when Settings turns captions off", () => {
    expect(watchCaptionEligibility(live, false)).toEqual({ kind: "hidden" });
  });
});
