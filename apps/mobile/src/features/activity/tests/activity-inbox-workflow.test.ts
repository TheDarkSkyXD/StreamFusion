import { describe, expect, it, vi } from "vitest";

import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import {
  createActivityInboxWorkflow,
  type ActivityInboxViewModel,
} from "../domain/activity-inbox-workflow";
import { createActivityInboxLifecycle } from "../domain/activity-inbox-lifecycle";
import { presentActivityItem } from "../domain/activity-presentation";

type ActivityItem = Parameters<ActivityRepository["record"]>[0];
type JobActivityItem = Extract<ActivityItem, { readonly kind: "job" }>;
type SystemActivityItem = Extract<ActivityItem, { readonly kind: "system" }>;
type SerializedTimestamp = SystemActivityItem["occurredAt"];

function systemItem(
  eventId: string,
  overrides: Partial<SystemActivityItem> = {},
): SystemActivityItem {
  return {
    body: "A local device event.",
    destination: { kind: "diagnostics" },
    event: "device-health",
    eventId,
    kind: "system",
    occurredAt: "2026-09-08T00:00:00.000Z" as SerializedTimestamp,
    readAt: null,
    schemaVersion: 1,
    source: "local",
    title: eventId,
    ...overrides,
  };
}

function jobItem(eventId: string): JobActivityItem {
  return {
    body: "A saved media job event.",
    destination: { jobId: "job:1", kind: "media-job" },
    eventId,
    job: { id: "job:1", state: { kind: "terminal" } },
    kind: "job",
    occurredAt: "2026-09-08T00:00:00.000Z" as SerializedTimestamp,
    readAt: null,
    schemaVersion: 1,
    source: "local",
    title: eventId,
  };
}


function channelLiveAlert(
  eventId: string,
  overrides: Partial<{
    readonly channelId: string;
    readonly login: string;
    readonly platform: "twitch" | "kick";
    readonly readAt: SerializedTimestamp | null;
  }> = {},
): ActivityItem {
  const channelId = overrides.channelId ?? "channel:alpha";
  const login = overrides.login ?? "alpha";
  const platform = overrides.platform ?? "twitch";
  return {
    body: "A followed channel went live.",
    channel: {
      displayName: "Alpha",
      id: channelId,
      login,
      platform,
    },
    destination: {
      channelId,
      channelLogin: login,
      kind: "watch-channel",
      platform,
    },
    event: "live-alert",
    eventId,
    kind: "channel",
    occurredAt: "2026-09-08T00:00:00.000Z" as SerializedTimestamp,
    readAt: overrides.readAt === undefined ? null : overrides.readAt,
    schemaVersion: 1,
    source: "local",
    title: "Alpha is live",
  };
}

function guestFollow(
  overrides: Partial<{
    readonly channelId: string;
    readonly channelLogin: string;
    readonly platform: "twitch" | "kick";
  }> = {},
) {
  return {
    channelId: overrides.channelId ?? "channel:alpha",
    channelLogin: overrides.channelLogin ?? "alpha",
    displayName: "Alpha",
    followedAt: "2026-09-01T00:00:00.000Z" as SerializedTimestamp,
    platform: overrides.platform ?? "twitch",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

function workflow(
  activityRepository: ActivityRepository,
  listMembership: () => Promise<readonly ReturnType<typeof guestFollow>[]> = async () => [
    guestFollow(),
  ],
) {
  return createActivityInboxWorkflow({
    listMembership,
    now: () => Date.parse("2026-09-08T01:00:00.000Z"),
    repository: activityRepository,
  });
}

describe("Activity inbox workflow", () => {
  it("keeps the foreground refresh result when the initial load completes late", async () => {
    const first = deferred<readonly ActivityItem[]>();
    const second = deferred<readonly ActivityItem[]>();
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const inbox = workflow(repository({ list }));

    const older = inbox.refresh();
    const newer = inbox.refresh();
    second.resolve([channelLiveAlert("event:new")]);
    await newer;
    first.resolve([channelLiveAlert("event:old")]);
    await older;

    expect(inbox.snapshot()).toMatchObject({
      isRefreshing: false,
      items: [{ eventId: "event:new" }],
      status: "ready",
    });
  });

  it("re-reads repository truth so a post-mark-all Activity event stays unread", async () => {
    const readAt = "2026-09-08T01:00:00.000Z" as SerializedTimestamp;
    const original = channelLiveAlert("event:original");
    const incoming = channelLiveAlert("event:incoming");
    const markAll = deferred<number>();
    let items: readonly ActivityItem[] = [original];
    const inbox = workflow(
      repository({
        list: async () => items,
        markAllRead: () =>
          markAll.promise.then(() => {
            items = items.map((item) =>
              item.eventId === original.eventId ? { ...item, readAt } : item,
            );
            return 1;
          }),
        record: async (item) => {
          items = [item, ...items];
          return { item, kind: "created" };
        },
      }),
    );
    await inbox.refresh();

    const markAllRead = inbox.markAllRead();
    expect(inbox.snapshot().isMarkingAllRead).toBe(true);
    await inbox.record(incoming);
    markAll.resolve(1);
    await markAllRead;

    expect(inbox.snapshot().items).toEqual([
      expect.objectContaining({ eventId: "event:incoming", readAt: null }),
      expect.objectContaining({ eventId: "event:original", readAt }),
    ]);
    expect(inbox.snapshot().unreadCount).toBe(1);
  });

  it("contains duplicate mark-all taps, exposes failure, and allows a later retry", async () => {
    const first = deferred<number>();
    const markAllRead = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(1);
    const inbox = workflow(repository({ markAllRead }));

    const active = inbox.markAllRead();
    await inbox.markAllRead();
    expect(markAllRead).toHaveBeenCalledTimes(1);
    first.reject(new Error("unavailable"));
    await active;
    expect(inbox.snapshot()).toMatchObject({
      isMarkingAllRead: false,
      mutationFailure: "mark-all",
    });

    await inbox.markAllRead();
    expect(markAllRead).toHaveBeenCalledTimes(2);
    expect(inbox.snapshot()).toMatchObject({
      isMarkingAllRead: false,
      mutationFailure: null,
    });
  });

  it("confirms only the captured completed IDs and refreshes followed go-lives", async () => {
    const completed = channelLiveAlert("event:completed");
    const remaining = channelLiveAlert("event:new");
    let stored: readonly ActivityItem[] = [completed];
    const dismissCompleted = vi
      .fn<ActivityRepository["dismissCompleted"]>()
      .mockImplementation(async (eventIds) => {
        const dismissedEventIds = [...eventIds];
        stored = stored.filter(
          (item) => !dismissedEventIds.includes(item.eventId),
        );
        return {
          activeEventIds: [],
          alreadyDismissedEventIds: [],
          dismissedEventIds,
          missingEventIds: [],
        };
      });
    const inbox = workflow(
      repository({ dismissCompleted, list: async () => stored }),
    );
    await inbox.refresh();
    inbox.dismissAllCompleted();
    stored = [remaining];
    await inbox.confirmDismissal();

    expect(dismissCompleted).toHaveBeenCalledWith(
      ["event:completed"],
      "2026-09-08T01:00:00.000Z",
    );
    expect(inbox.snapshot()).toMatchObject({
      dismissalConfirmation: null,
      dismissalResult: { activeCount: 0, dismissedCount: 1, missingCount: 0 },
      items: [{ eventId: "event:new" }],
    });
  });

  it("keeps the captured dismissal confirmation retryable after a failed write", async () => {
    const item = channelLiveAlert("event:dismiss");
    const dismissCompleted = vi
      .fn<ActivityRepository["dismissCompleted"]>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        activeEventIds: [],
        alreadyDismissedEventIds: [],
        dismissedEventIds: [item.eventId],
        missingEventIds: [],
      });
    const inbox = workflow(
      repository({ dismissCompleted, list: async () => [item] }),
    );
    await inbox.refresh();
    inbox.dismissItem(item.eventId);
    await inbox.confirmDismissal();
    expect(inbox.snapshot()).toMatchObject({
      dismissalConfirmation: { eventIds: [item.eventId], kind: "dismiss-item" },
      dismissalFailure: true,
      isDismissing: false,
    });
    await inbox.confirmDismissal();
    expect(dismissCompleted).toHaveBeenCalledTimes(2);
  });

  it("removes an already-hidden confirmation target when its authoritative refresh fails", async () => {
    const item = channelLiveAlert("event:hidden");
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("unavailable"));
    const inbox = workflow(
      repository({
        dismissCompleted: async () => ({
          activeEventIds: [],
          alreadyDismissedEventIds: [item.eventId],
          dismissedEventIds: [],
          missingEventIds: [],
        }),
        list,
      }),
    );
    await inbox.refresh();
    inbox.dismissItem(item.eventId);
    await inbox.confirmDismissal();

    expect(inbox.snapshot()).toMatchObject({
      dismissalResult: {
        activeCount: 0,
        alreadyDismissedCount: 1,
        dismissedCount: 0,
        missingCount: 0,
      },
      items: [],
      status: "unavailable",
    });
  });

  it("contains a pruned confirmation target when its authoritative refresh fails", async () => {
    const item = channelLiveAlert("event:pruned");
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("unavailable"));
    const inbox = workflow(
      repository({
        dismissCompleted: async () => ({
          activeEventIds: [],
          alreadyDismissedEventIds: [],
          dismissedEventIds: [],
          missingEventIds: [item.eventId],
        }),
        list,
      }),
    );
    await inbox.refresh();
    inbox.dismissItem(item.eventId);
    await inbox.confirmDismissal();

    expect(inbox.snapshot()).toMatchObject({
      dismissalResult: {
        activeCount: 0,
        alreadyDismissedCount: 0,
        dismissedCount: 0,
        missingCount: 1,
      },
      items: [],
      status: "unavailable",
    });
  });

  it("settles an invalidated refresh when mark-all fails", async () => {
    const pendingList = deferred<readonly ActivityItem[]>();
    const inbox = workflow(
      repository({
        list: () => pendingList.promise,
        markAllRead: async () => {
          throw new Error("unavailable");
        },
      }),
    );

    const refresh = inbox.refresh();
    expect(inbox.snapshot().isRefreshing).toBe(true);
    await inbox.markAllRead();
    pendingList.resolve([channelLiveAlert("event:late")]);
    await refresh;

    expect(inbox.snapshot()).toMatchObject({
      isMarkingAllRead: false,
      isRefreshing: false,
      mutationFailure: "mark-all",
      status: "unavailable",
    });
  });

  it("keeps another Activity row busy while an earlier mark-read refresh settles", async () => {
    const firstRefresh = deferred<readonly ActivityItem[]>();
    const secondRefresh = deferred<readonly ActivityItem[]>();
    const stored = [channelLiveAlert("event:first"), channelLiveAlert("event:second")];
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockResolvedValueOnce(stored)
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    const firstMark = deferred<null>();
    const secondMark = deferred<null>();
    const markRead = vi
      .fn<(eventId: string, readAt: SerializedTimestamp) => Promise<null>>()
      .mockImplementationOnce(() => firstMark.promise)
      .mockImplementationOnce(() => secondMark.promise);
    const inbox = workflow(repository({ list, markRead }));
    await inbox.refresh();

    const first = inbox.markRead("event:first");
    const second = inbox.markRead("event:second");
    firstMark.resolve(null);
    secondMark.resolve(null);
    firstRefresh.resolve(stored);
    await first;

    expect(inbox.snapshot().markingReadEventIds).toEqual(["event:second"]);
    secondRefresh.resolve(stored);
    await second;
    expect(inbox.snapshot().markingReadEventIds).toEqual([]);
  });

  it("keeps retained followed go-lives visible and exposes an unavailable refresh", async () => {
    const item = channelLiveAlert("event:stored");
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("unavailable"));
    const inbox = workflow(repository({ list }));
    await inbox.refresh();
    inbox.selectFilter("jobs");
    await inbox.refresh();

    expect(inbox.snapshot()).toMatchObject({
      filter: "channels",
      isRefreshing: false,
      items: [{ eventId: "event:stored" }],
      status: "unavailable",
    });
  });

  it("shows only followed live-alerts and hides jobs, system, and unfollowed channels", async () => {
    const followed = channelLiveAlert("event:followed");
    const unfollowed = channelLiveAlert("event:other", {
      channelId: "channel:other",
      login: "other",
    });
    const inbox = workflow(
      repository({
        list: async () => [
          followed,
          unfollowed,
          jobItem("event:job"),
          systemItem("event:system"),
        ],
      }),
      async () => [guestFollow()],
    );
    await inbox.refresh();
    expect(inbox.snapshot().items.map((item) => item.eventId)).toEqual([
      "event:followed",
    ]);
    expect(inbox.snapshot().unreadCount).toBe(1);
  });

  it("does not publish a completed mutation after disposal", async () => {
    const pending = deferred<number>();
    const inbox = workflow(repository({ markAllRead: () => pending.promise }));
    const listener = vi.fn<(snapshot: ActivityInboxViewModel) => void>();
    inbox.subscribe(listener);

    const mutation = inbox.markAllRead();
    inbox.dispose();
    pending.resolve(1);
    await mutation;

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not start a record after disposal", async () => {
    const record = vi.fn<ActivityRepository["record"]>();
    const inbox = workflow(repository({ record }));

    inbox.dispose();
    await inbox.record(systemItem("event:after-dispose"));

    expect(record).not.toHaveBeenCalled();
  });

  it("replaces a disposed setup with a fresh workflow", async () => {
    const first = deferred<readonly ActivityItem[]>();
    const second = deferred<readonly ActivityItem[]>();
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const lifecycle = createActivityInboxLifecycle({
      listMembership: async () => [guestFollow()],
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
      repository: repository({ list }),
    });
    const listener = vi.fn<(snapshot: ActivityInboxViewModel) => void>();

    const detachFirst = lifecycle.attach(listener);
    detachFirst();
    const detachSecond = lifecycle.attach(listener);
    second.resolve([channelLiveAlert("event:second")]);
    await second.promise;
    first.resolve([channelLiveAlert("event:first")]);
    await first.promise;

    expect(lifecycle.snapshot()).toMatchObject({
      items: [{ eventId: "event:second" }],
      status: "ready",
    });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ eventId: "event:second" })],
      }),
    );
    detachSecond();
  });

  it("contains failed record and mark-read mutations without stale busy state", async () => {
    const stored = channelLiveAlert("event:stored");
    const inbox = workflow(
      repository({
        list: async () => [stored],
        markRead: async () => {
          throw new Error("unavailable");
        },
        record: async () => {
          throw new Error("unavailable");
        },
      }),
    );
    await inbox.refresh();

    await inbox.markRead(stored.eventId);
    expect(inbox.snapshot()).toMatchObject({
      markingReadEventIds: [],
      mutationFailure: "mark-read",
    });

    await inbox.record(systemItem("event:record"));
    expect(inbox.snapshot()).toMatchObject({
      markingReadEventIds: [],
      mutationFailure: "record",
    });
  });
});

describe("Activity presentation", () => {
  it("uses typed provenance without inventing a platform for local system work", () => {
    expect(presentActivityItem(systemItem("event:system"))).toEqual({
      deliveryLabel: "Local",
      eventIdentity: "event:system",
      kindLabel: "System",
      provenanceLabel: "System · Local",
      visual: "system",
    });
  });

  it("uses the channel Platform and relay delivery from the persisted item", () => {
    const item: ActivityItem = {
      body: "A channel is live.",
      channel: {
        displayName: "Alpha",
        id: "channel:alpha",
        login: "alpha",
        platform: "twitch",
      },
      destination: {
        channelId: "channel:alpha",
        channelLogin: "alpha",
        kind: "watch-channel",
        platform: "twitch",
      },
      event: "live-alert",
      eventId: "event:channel",
      kind: "channel",
      occurredAt: "2026-09-08T00:00:00.000Z" as SerializedTimestamp,
      readAt: null,
      schemaVersion: 1,
      source: "relay",
      title: "Alpha is live",
    };

    expect(presentActivityItem(item)).toMatchObject({
      deliveryLabel: "Relay",
      provenanceLabel: "Twitch · Relay",
      visual: "channel",
    });
  });
});
