import { describe, expect, it } from "vitest";

import {
  watchRecordingEligibility,
  watchRecordingJobId,
} from "../domain/watch-recording";
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

// Guards: live Watch offers Record with a stable job id; Videos and Clips hide recording
describe("Watch recording eligibility", () => {
  it("offers a stable live recording job id without OAuth", () => {
    expect(watchRecordingEligibility(live)).toMatchObject({
      kind: "eligible",
      jobId: "rec-twitch-twitch-1",
      label: "Record",
    });
    expect(watchRecordingJobId(live)).toBe("rec-twitch-twitch-1");
  });

  it("hides recording on Videos and Clips", () => {
    expect(watchRecordingEligibility(video)).toEqual({ kind: "hidden" });
    expect(watchRecordingJobId(video)).toBeNull();
  });
});
