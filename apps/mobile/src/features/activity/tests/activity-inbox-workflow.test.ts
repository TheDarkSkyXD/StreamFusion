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
    list: async () => [],
    markAllRead: async () => 0,
    markRead: async () => null,
    record: async (item) => ({ item, kind: "created" }),
    ...overrides,
  };
}

function workflow(activityRepository: ActivityRepository) {
  return createActivityInboxWorkflow({
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
    second.resolve([systemItem("event:new")]);
    await newer;
    first.resolve([systemItem("event:old")]);
    await older;

    expect(inbox.snapshot()).toMatchObject({
      isRefreshing: false,
      items: [{ eventId: "event:new" }],
      status: "ready",
    });
  });

  it("re-reads repository truth so a post-mark-all Activity event stays unread", async () => {
    const readAt = "2026-09-08T01:00:00.000Z" as SerializedTimestamp;
    const original = systemItem("event:original");
    const incoming = systemItem("event:incoming");
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
    pendingList.resolve([systemItem("event:late")]);
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
    const stored = [systemItem("event:first"), systemItem("event:second")];
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

  it("keeps retained filtered items visible and exposes an unavailable refresh", async () => {
    const item = jobItem("event:stored");
    const list = vi
      .fn<() => Promise<readonly ActivityItem[]>>()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("unavailable"));
    const inbox = workflow(repository({ list }));
    await inbox.refresh();
    inbox.selectFilter("jobs");
    await inbox.refresh();

    expect(inbox.snapshot()).toMatchObject({
      filter: "jobs",
      isRefreshing: false,
      items: [{ eventId: "event:stored" }],
      status: "unavailable",
    });
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
      now: () => Date.parse("2026-09-08T01:00:00.000Z"),
      repository: repository({ list }),
    });
    const listener = vi.fn<(snapshot: ActivityInboxViewModel) => void>();

    const detachFirst = lifecycle.attach(listener);
    detachFirst();
    const detachSecond = lifecycle.attach(listener);
    second.resolve([systemItem("event:second")]);
    await second.promise;
    first.resolve([systemItem("event:first")]);
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
    const stored = systemItem("event:stored");
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
