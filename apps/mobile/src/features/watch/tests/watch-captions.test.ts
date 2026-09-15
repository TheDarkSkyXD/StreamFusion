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

// Guards: live Watch offers local captions with a stable session id; Videos and Clips hide captions
describe("Watch caption eligibility", () => {
  it("offers a stable live caption session id without OAuth", () => {
    expect(watchCaptionEligibility(live)).toEqual({
      kind: "eligible",
      label: "Captions",
      sessionId: "cap-twitch-twitch-1",
    });
    expect(watchCaptionSessionId(live)).toBe("cap-twitch-twitch-1");
  });

  it("hides captions on Videos and Clips", () => {
    expect(watchCaptionEligibility(video)).toEqual({ kind: "hidden" });
    expect(watchCaptionSessionId(video)).toBeNull();
  });

  it("hides live captions when Settings turns them off", () => {
    expect(watchCaptionEligibility(live, false)).toEqual({ kind: "hidden" });
  });
});
