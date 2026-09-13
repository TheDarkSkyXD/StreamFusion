import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import { composeFollowingView } from "../domain/compose-following-view";
import { guestFollowMutation } from "../domain/guest-follow-mutation";
import {
  followedStream,
  followedVideo,
  guestFollow,
  liveOutcome,
  recordedOutcome,
} from "../domain/following-fixtures";

const twitchFollow = guestFollow({
  channelId: "twitch-1",
  channelLogin: "twitchlive",
  platform: "twitch",
});
const kickFollow = guestFollow({
  channelId: "kick-1",
  channelLogin: "kicklive",
  displayName: "KickAlice",
  platform: "kick",
});

describe("composeFollowingView", () => {
  it("uses no-membership when the device has no Guest Follows", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "live",
    });
    expect(view.live).toEqual({ kind: "empty", reason: "no-membership" });
    expect(view.origin).toEqual({ kind: "guest" });
    expect(view.accountImport).toEqual({
      kind: "disabled",
      reason: "guest-only-scope",
    });
    expect(view.systemPush).toEqual({
      kind: "stubbed",
      reason: "system-push-not-shipped",
    });
  });

  it("uses none-live when Guest Follows exist but nobody is live", () => {
    const view = composeFollowingView({
      chip: "all",
      kick: liveOutcome("kick", "complete"),
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow, kickFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "live",
      twitch: liveOutcome("twitch", "complete"),
    });
    expect(view.live).toEqual({ kind: "empty", reason: "none-live" });
  });

  it("uses no-matches for local search and chips", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "zzz",
      tab: "live",
      twitch: liveOutcome("twitch", "complete", [
        followedStream({
          channelId: "twitch-1",
          channelName: "twitchlive",
          platform: "twitch",
        }),
      ]),
    });
    expect(view.live).toEqual({ kind: "empty", reason: "no-matches" });
  });

  it("keeps membership when live hydration reports missing identities", () => {
    const stream = followedStream({
      channelId: "twitch-1",
      channelName: "twitchlive",
      categoryId: "art",
      categoryName: "Art",
      platform: "twitch",
    });
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      tab: "channels",
      twitch: {
        ...liveOutcome("twitch", "complete", [stream]),
        missing: [{ kind: "id", value: "twitch-1" }],
      },
    });
    expect(view.membership).toEqual([twitchFollow]);
    expect(view.live.kind).toBe("ready");
    expect(view.channels.kind).toBe("ready");
    expect(view.categories.kind).toBe("ready");
  });
});

describe("guestFollowMutation", () => {
  it("rejects account mutations while this slice is guest-only", () => {
    expect(
      guestFollowMutation({
        authenticated: true,
        membership: [],
        platform: "twitch",
        channelLogin: "alice",
      }),
    ).toEqual({ kind: "rejected", reason: "guest-only-scope" });
  });

  it("follows a new guest channel and unfollows an existing one", () => {
    expect(
      guestFollowMutation({
        authenticated: false,
        membership: [],
        platform: "twitch",
        channelLogin: "alice",
      }),
    ).toEqual({ kind: "follow" });
    expect(
      guestFollowMutation({
        authenticated: false,
        channelId: twitchFollow.channelId,
        membership: [twitchFollow],
        platform: "twitch",
      }),
    ).toEqual({ follow: twitchFollow, kind: "unfollow" });
  });
});

describe("composeFollowingView recorded tabs", () => {
  it("marks Kick videos as unsupported without treating that as failure", () => {
    const view = composeFollowingView({
      chip: "kick",
      loadingLive: false,
      loadingRecorded: false,
      membership: [kickFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      recorded: [recordedOutcome({ platform: "kick", supported: false })],
      tab: "videos",
    });
    expect(view.videos).toEqual({
      items: [],
      kind: "unsupported",
      reason: "kick-recorded-unsupported",
    });
  });

  it("keeps Twitch videos when a Kick Guest Follow is unsupported", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [kickFollow, twitchFollow],
      notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      query: "",
      recorded: [
        recordedOutcome({ platform: "kick", supported: false }),
        recordedOutcome({
          items: [followedVideo({ id: "video-1", platform: "twitch" })],
          platform: "twitch",
        }),
      ],
      tab: "videos",
    });
    expect(view.videos.kind).toBe("ready");
    expect(view.videos.kind === "ready" && view.videos.items[0]?.id).toBe(
      "video-1",
    );
  });

  it("marks Guest Follows ineligible when guest live alerts are off", () => {
    const view = composeFollowingView({
      chip: "all",
      loadingLive: false,
      loadingRecorded: false,
      membership: [twitchFollow],
      notifications: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      query: "",
      tab: "channels",
      twitch: liveOutcome("twitch", "complete"),
    });
    expect(view.channels.kind).toBe("ready");
    expect(
      view.channels.kind === "ready" && view.channels.items[0]?.eligible,
    ).toBe(false);
    expect(
      view.channels.kind === "ready" && view.channels.items[0]?.origin,
    ).toEqual({ kind: "guest" });
    expect(
      view.channels.kind === "ready" && view.channels.items[0]?.imported,
    ).toEqual({ kind: "none" });
  });
});
