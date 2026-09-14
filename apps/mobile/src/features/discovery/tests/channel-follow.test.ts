import { describe, expect, it } from "vitest";
import { parseGuestFollowWrite } from "@streamfusion/core/follows";

import {
  composeGuestFollowView,
  followActionLabel,
  followCopy,
  providerPageLabel,
} from "../domain/channel-follow";

const channel = {
  id: "twitch-c1",
  platform: "twitch" as const,
  username: "twitch-live",
};

function followRow() {
  const follow = parseGuestFollowWrite({
    channelId: "twitch-c1",
    channelLogin: "twitch-live",
    displayName: "Twitch Live",
    followedAt: "2026-09-11T00:00:00.000Z",
    platform: "twitch",
  });
  if (follow === null) {
    throw new RangeError("invalid Guest Follow fixture");
  }
  return follow;
}

describe("composeGuestFollowView", () => {
  it("keeps Follow pending ahead of membership", () => {
    expect(
      composeGuestFollowView({
        channel,
        error: "Guest Follow could not be saved.",
        membership: [followRow()],
        pending: true,
      }),
    ).toEqual({ kind: "pending" });
  });

  it("surfaces a failed write", () => {
    expect(
      composeGuestFollowView({
        channel,
        error: "Guest Follow could not be saved.",
        membership: [],
        pending: false,
      }),
    ).toEqual({
      kind: "failed",
      reason: "Guest Follow could not be saved.",
    });
  });

  it("treats a matching row as present", () => {
    expect(
      composeGuestFollowView({
        channel,
        membership: [followRow()],
        pending: false,
      }),
    ).toEqual({ kind: "guest-present" });
  });

  it("treats an empty list as absent", () => {
    expect(
      composeGuestFollowView({
        channel,
        membership: [],
        pending: false,
      }),
    ).toEqual({ kind: "guest-absent" });
  });
});

describe("follow copy", () => {
  it("labels Follow and Unfollow from Guest Follow state", () => {
    expect(followActionLabel({ kind: "guest-absent" })).toBe("Follow");
    expect(followActionLabel({ kind: "guest-present" })).toBe("Unfollow");
    expect(followCopy({ kind: "guest-absent" })).toBe(
      "Save this channel as a Guest Follow on this device.",
    );
    expect(followCopy({ kind: "guest-present" })).toBe(
      "This channel is a Guest Follow on this device.",
    );
    expect(providerPageLabel("twitch")).toBe("Open on Twitch");
    expect(providerPageLabel("kick")).toBe("Open on Kick");
  });
});
