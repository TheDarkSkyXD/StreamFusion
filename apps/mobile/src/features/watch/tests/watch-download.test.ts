import { describe, expect, it } from "vitest";

import {
  watchDownloadEligibility,
  watchDownloadJobId,
} from "../domain/watch-download";
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

const twitchClip: WatchTarget = {
  ...live,
  media: {
    durationSeconds: 30,
    id: "AwkwardHelplessSalamanderSwiftRage",
    kind: "clip",
    title: "Clip",
  },
};

const kickClip: WatchTarget = {
  channelId: "kick-1",
  channelName: "clipper",
  platform: "kick",
  media: {
    durationSeconds: 12,
    id: "clip-1",
    kind: "clip",
    title: "Kick clip",
  },
};

// Guards: live Watch hides download; Kick clips stay unsupported; Videos/Clips get a stable job id
describe("Watch download eligibility", () => {
  it("hides download on live Watch", () => {
    expect(watchDownloadEligibility(live)).toEqual({ kind: "hidden" });
    expect(watchDownloadJobId(live)).toBeNull();
  });

  it("offers a stable Video job id without OAuth", () => {
    const eligibility = watchDownloadEligibility(video);
    expect(eligibility).toMatchObject({
      kind: "eligible",
      jobId: "dl-twitch-video-vod-99",
      label: "Download video",
    });
  });

  it("offers a stable Twitch Clip job id", () => {
    expect(watchDownloadJobId(twitchClip)).toBe(
      "dl-twitch-clip-AwkwardHelplessSalamanderSwiftRage",
    );
  });

  it("keeps Kick clips unavailable in this build", () => {
    expect(watchDownloadEligibility(kickClip)).toEqual({
      kind: "unsupported",
      reason: "Kick clips are not available in this build.",
    });
  });
});

describe("intentional download copies", () => {
  it("uses distinct native file identities while preserving the source identity", async () => {
    const { watchDownloadCopyId } =
      await import("../domain/watch-download-copy");
    const base = watchDownloadEligibility({
      platform: "twitch",
      channelId: "channel",
      channelName: "channel",
      media: {
        id: "123",
        kind: "video",
        title: "Broadcast",
        durationSeconds: 100,
      },
    });
    expect(base.kind).toBe("eligible");
    if (base.kind !== "eligible")
      throw new Error("Expected an eligible recording");
    const first = watchDownloadCopyId(base.jobId, 1234, [base.jobId]);
    const second = watchDownloadCopyId(base.jobId, 1234, [base.jobId, first]);
    expect(first).toBe("dl-twitch-video-123-copy-1234-1");
    expect(second).toBe("dl-twitch-video-123-copy-1234-2");
  });
});
