import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveNotificationInput } from "@/store/notification-store";
import { useNotificationStore } from "@/store/notification-store";

function makeNotification(overrides: Partial<LiveNotificationInput> = {}): LiveNotificationInput {
  return {
    id: "notif-1",
    platform: "twitch",
    channelId: "channel-1",
    channelName: "testchannel",
    channelDisplayName: "TestChannel",
    title: "Test stream",
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.setState({ notifications: [] });
});

// Guards: Live Notification history must retain only real persisted activity, newest first, with a bounded list.
describe("notification-store history", () => {
  it("adds real Live Notifications newest first and caps history at 50", () => {
    for (let i = 0; i < 55; i++) {
      useNotificationStore.getState().addNotification(
        makeNotification({
          id: `notif-${i}`,
          channelId: `channel-${i}`,
          title: `Stream ${i}`,
          createdAt: i,
        })
      );
    }

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(50);
    expect(notifications[0]).toMatchObject({ id: "notif-54", title: "Stream 54" });
    expect(notifications.at(-1)).toMatchObject({ id: "notif-5", title: "Stream 5" });
  });

  it("persists Live Notification history to local storage", () => {
    useNotificationStore.getState().addNotification(makeNotification({ title: "Persisted stream" }));

    const persisted = JSON.parse(
      localStorage.getItem("streamfusion-live-notification-store") ?? "{}"
    ) as { state?: { notifications?: Array<{ title?: string }> } };

    expect(persisted.state?.notifications?.[0]?.title).toBe("Persisted stream");
  });

  it("marks all notifications read without deleting history", () => {
    const readAt = new Date("2026-07-02T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(readAt);
    useNotificationStore.getState().addNotification(makeNotification({ id: "notif-1" }));
    useNotificationStore.getState().addNotification(makeNotification({ id: "notif-2" }));

    useNotificationStore.getState().markAllRead();

    expect(useNotificationStore.getState().notifications).toMatchObject([
      { id: "notif-2", readAt },
      { id: "notif-1", readAt },
    ]);
  });
});
