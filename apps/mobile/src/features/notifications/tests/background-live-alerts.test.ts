import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import {
  buildBackgroundSnapshot,
  verifiedLiveObservations,
} from "../domain/background-live-alerts";
import { followedStream } from "@mobile/features/follows/domain/following-fixtures";

const guest = {
  platform: "twitch" as const,
  channelId: "guest-id",
  channelLogin: "guest",
  displayName: "Guest",
  followedAt: "2026-09-01T00:00:00.000Z",
};
const account = {
  platform: "kick" as const,
  channelId: "account-id",
  channelLogin: "account",
  displayName: "Account",
  followedAt: "2026-09-01T00:00:00.000Z",
};

describe("background live snapshot", () => {
  it("uses a verified renamed login for the saved ID without changing the native wire", () => {
    const membership = [
      { ...guest, channelId: "123", channelLogin: "oldlogin" },
    ];
    const observations = verifiedLiveObservations({
      membership,
      accountLive: [],
      observedAtMs: { twitch: 100, kick: 100, account: 100 },
      outcomes: {
        twitch: {
          platform: "twitch",
          status: "complete",
          items: [
            followedStream({
              platform: "twitch",
              channelId: "123",
              channelName: "newlogin",
            }),
          ],
          missing: [],
          stale: false,
          offline: false,
          retryable: false,
        },
        kick: {
          platform: "kick",
          status: "complete",
          items: [],
          missing: [],
          stale: false,
          offline: false,
          retryable: false,
        },
      },
    });
    const snapshot = buildBackgroundSnapshot({
      membership,
      guestMembership: membership,
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      observations,
    });
    expect(snapshot.channels).toEqual([
      {
        platform: "twitch",
        channelId: "123",
        channelLogin: "newlogin",
        displayName: "Guest",
      },
    ]);
    expect(snapshot.observations).toEqual([
      {
        platform: "twitch",
        channelId: "123",
        observedAtMs: 100,
        kind: "live",
        streamId: "twitch-stream",
        title: "twitch live",
      },
    ]);
  });

  it("rejects a reused Twitch login belonging to a different canonical ID", () => {
    expect(
      verifiedLiveObservations({
        membership: [{ ...guest, channelId: "123" }],
        accountLive: [],
        observedAtMs: { twitch: 100, kick: 100, account: 100 },
        outcomes: {
          twitch: {
            platform: "twitch",
            status: "complete",
            items: [
              followedStream({
                platform: "twitch",
                channelId: "456",
                channelName: "guest",
              }),
            ],
            missing: [],
            stale: false,
            offline: false,
            retryable: false,
          },
          kick: {
            platform: "kick",
            status: "complete",
            items: [],
            missing: [],
            stale: false,
            offline: false,
            retryable: false,
          },
        },
      }),
    ).toEqual([]);
  });

  it("keeps account follows eligible when guest alerts are disabled and history on", () => {
    const snapshot = buildBackgroundSnapshot({
      guestMembership: [guest],
      membership: [guest, account],
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        enabled: false,
        guestFollows: false,
      },
      observations: [],
    });
    expect(snapshot.channels).toEqual([
      {
        platform: "kick",
        channelId: "account-id",
        channelLogin: "account",
        displayName: "Account",
      },
    ]);
    expect(snapshot.policy).toEqual({
      historyEnabled: true,
      systemAlerts: false,
      toastAlerts: true,
      sound: true,
      restartGraceMinutes: 0,
    });
  });

  it("uses stable stream identity only from fresh successful reads", () => {
    const stream = {
      id: "stream-123",
      platform: "twitch" as const,
      channelId: "guest-id",
      channelName: "guest",
      channelDisplayName: "Guest",
      channelAvatar: "",
      title: "Live title",
      viewerCount: 4,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "",
      tags: [],
    };
    const observations = verifiedLiveObservations({
      membership: [guest, account],
      accountLive: [],
      observedAtMs: { twitch: 1000, kick: 1100, account: 1200 },
      outcomes: {
        twitch: {
          platform: "twitch",
          status: "complete",
          items: [stream],
          missing: [],
          stale: false,
          offline: false,
          retryable: false,
        },
        kick: {
          platform: "kick",
          status: "failed",
          items: [],
          missing: [],
          stale: false,
          offline: false,
          retryable: true,
        },
      },
    });
    expect(observations).toEqual([
      {
        platform: "twitch",
        channelId: "guest-id",
        channelLogin: "guest",
        observedAtMs: 1000,
        kind: "live",
        streamId: "stream-123",
        title: "Live title",
      },
    ]);
    expect(
      verifiedLiveObservations({
        membership: [guest],
        accountLive: [],
        observedAtMs: { twitch: 2000, kick: 2000, account: 2000 },
        outcomes: {
          twitch: {
            platform: "twitch",
            status: "stale",
            items: [stream],
            missing: [],
            stale: true,
            offline: false,
            retryable: true,
          },
          kick: {
            platform: "kick",
            status: "partial",
            items: [],
            missing: [],
            stale: false,
            offline: false,
            retryable: true,
          },
        },
      }),
    ).toEqual([]);
  });

  it("forwards only explicitly verified offline channels", () => {
    expect(
      verifiedLiveObservations({
        membership: [guest, account],
        accountLive: [],
        observedAtMs: { twitch: 2000, kick: 2000, account: 2000 },
        outcomes: {
          twitch: {
            platform: "twitch",
            status: "complete",
            items: [],
            missing: [],
            verifiedOfflineChannelIds: ["guest-id"],
            stale: false,
            offline: false,
            retryable: false,
          },
          kick: {
            platform: "kick",
            status: "failed",
            items: [],
            missing: [],
            verifiedOfflineChannelIds: ["account-id"],
            stale: false,
            offline: false,
            retryable: true,
          },
        },
      }),
    ).toEqual([
      {
        platform: "twitch",
        channelId: "guest-id",
        observedAtMs: 2000,
        kind: "offline",
      },
    ]);
  });
});
