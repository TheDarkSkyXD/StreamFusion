import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { Stream } from "@streamfusion/core/content";

import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import { filterFollowedLiveAlerts } from "../domain/activity-followed-feed";
import {
  createGuestLiveAlertReconciler,
  liveAlertFromStream,
} from "../domain/guest-live-alert-reconciler";

const follow: GuestFollow = {
  channelId: "channel:alpha",
  channelLogin: "alpha",
  displayName: "Alpha",
  followedAt: "2026-09-01T00:00:00.000Z" as GuestFollow["followedAt"],
  platform: "twitch",
};

function stream(overrides: Partial<Stream> = {}): Stream {
  return {
    channelAvatar: "",
    channelDisplayName: "Alpha",
    channelId: "channel:alpha",
    channelName: "alpha",
    id: "stream:1",
    isLive: true,
    language: "en",
    platform: "twitch",
    startedAt: "2026-09-08T00:00:00.000Z" as Stream["startedAt"],
    tags: [],
    thumbnailUrl: "",
    title: "Playing something",
    viewerCount: 12,
    ...overrides,
  };
}

function repository(
  overrides: Partial<ActivityRepository> = {},
): ActivityRepository {
  return {
    dismissCompleted: async () => ({
      activeEventIds: [],
      alreadyDismissedEventIds: [],
      dismissedEventIds: [],
      missingEventIds: [],
    }),
    list: async () => [],
    markAllRead: async () => 0,
    markRead: async () => null,
    record: async (item) => ({ item, kind: "created" }),
    ...overrides,
  };
}

describe("filterFollowedLiveAlerts", () => {
  it("keeps followed live-alerts and drops jobs, system, and unfollowed channels", () => {
    const followed = liveAlertFromStream(stream(), follow, Date.parse("2026-09-08T01:00:00.000Z"));
    const other = liveAlertFromStream(
      stream({ channelId: "channel:other", channelName: "other" }),
      { ...follow, channelId: "channel:other", channelLogin: "other", displayName: "Other" },
      Date.parse("2026-09-08T01:00:00.000Z"),
    );
    const job = {
      body: "job",
      destination: { jobId: "job:1", kind: "media-job" as const },
      eventId: "event:job",
      job: { id: "job:1", state: { kind: "terminal" as const } },
      kind: "job" as const,
      occurredAt: followed.occurredAt,
      readAt: null,
      schemaVersion: 1 as const,
      source: "local" as const,
      title: "Job",
    };
    const system = {
      body: "system",
      destination: { kind: "diagnostics" as const },
      event: "device-health" as const,
      eventId: "event:system",
      kind: "system" as const,
      occurredAt: followed.occurredAt,
      readAt: null,
      schemaVersion: 1 as const,
      source: "local" as const,
      title: "System",
    };
    const visible = filterFollowedLiveAlerts(
      [followed, other, job, system],
      [follow],
    );
    expect(visible.map((item) => item.eventId)).toEqual([followed.eventId]);
  });
});

describe("guest live-alert reconciler", () => {
  it("records a go-live Activity after silent priming when a follow transitions live", async () => {
    const record = vi.fn<ActivityRepository["record"]>(async (item) => ({
      item,
      kind: "created",
    }));
    const reconciler = createGuestLiveAlertReconciler({
      activity: repository({ record }),
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
    });

    await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      silent: true,
      streams: [stream()],
    });
    expect(record).not.toHaveBeenCalled();

    await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      streams: [],
    });
    const recorded = await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      streams: [stream()],
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      event: "live-alert",
      kind: "channel",
      source: "local",
      title: "Alpha is live",
    });
  });


  it("presents a local system notification on offline-to-live when supported", async () => {
    const record = vi.fn<ActivityRepository["record"]>(async (item) => ({
      item,
      kind: "created",
    }));
    const presentSystemNotification = vi.fn(async () => undefined);
    const reconciler = createGuestLiveAlertReconciler({
      activity: repository({ record }),
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
      presentSystemNotification,
      systemNotificationsSupported: true,
    });

    await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      silent: true,
      streams: [stream()],
    });
    await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      streams: [],
    });
    await reconciler.observe({
      membership: [follow],
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      streams: [stream()],
    });

    expect(presentSystemNotification).toHaveBeenCalledTimes(1);
    expect(presentSystemNotification.mock.calls[0]?.[0]).toMatchObject({
      silent: false,
      item: { event: "live-alert", title: "Alpha is live" },
    });
  });

  it("ignores ineligible Guest Follow preferences", async () => {
    const record = vi.fn<ActivityRepository["record"]>();
    const reconciler = createGuestLiveAlertReconciler({
      activity: repository({ record }),
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
    });
    await reconciler.observe({
      membership: [follow],
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      silent: false,
      streams: [stream()],
    });
    expect(record).not.toHaveBeenCalled();
  });
});

describe("account follow live-alert reconciler", () => {
  it("records account-follow go-lives when guestFollows pref is off", async () => {
    const record = vi.fn<ActivityRepository["record"]>(async (item) => ({
      item,
      kind: "created",
    }));
    const reconciler = createGuestLiveAlertReconciler({
      activity: repository({ record }),
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
    });
    const accountOnly = follow;
    await reconciler.observe({
      guestMembership: [],
      membership: [accountOnly],
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      silent: true,
      streams: [stream()],
    });
    await reconciler.observe({
      guestMembership: [],
      membership: [accountOnly],
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      streams: [],
    });
    const recorded = await reconciler.observe({
      guestMembership: [],
      membership: [accountOnly],
      preferences: {
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        guestFollows: false,
      },
      streams: [stream()],
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
  });
});
