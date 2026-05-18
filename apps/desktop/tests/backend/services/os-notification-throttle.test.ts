import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OSNotificationThrottle } from "@/backend/services/os-notification-throttle";

// Minimal Notification stub. Records constructor calls so each test can
// inspect the title / body the throttle fired.
interface NotifCall {
  title: string;
  body: string | undefined;
}

function makeMockNotification(permission: NotificationPermission): {
  Ctor: typeof Notification;
  calls: NotifCall[];
} {
  const calls: NotifCall[] = [];
  class MockNotification {
    static permission: NotificationPermission = permission;
    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve(MockNotification.permission);
    }
    constructor(title: string, opts?: NotificationOptions) {
      calls.push({ title, body: opts?.body });
    }
  }
  return {
    Ctor: MockNotification as unknown as typeof Notification,
    calls,
  };
}

describe("OSNotificationThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately on the first enqueue when permission is granted", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "hello world",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      title: "Held message on Streamer",
      body: "hello world",
    });
  });

  it("a single enqueue does NOT fire a second aggregate when the window closes", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "hello",
    });
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(30_001);
    // The window closed but only the immediate first-fire happened — no
    // aggregate, because nothing accumulated.
    expect(calls).toHaveLength(1);
  });

  it("two enqueues within the window fire one immediate + one aggregate at close", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "first",
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "second",
    });
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(30_001);
    expect(calls).toHaveLength(2);
    expect(calls[1].title).toBe("2 held messages on Streamer");
  });

  it("three enqueues in the window: first fires single, aggregate says '3 held'", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "first",
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "second",
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "third",
    });
    expect(calls[0].title).toBe("Held message on Streamer");
    expect(calls[0].body).toBe("first");
    vi.advanceTimersByTime(30_001);
    expect(calls).toHaveLength(2);
    expect(calls[1].title).toBe("3 held messages on Streamer");
  });

  it("permission='denied' yields no notifications and no aggregate fire", () => {
    const { Ctor, calls } = makeMockNotification("denied");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "hello",
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "hello again",
    });
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(30_001);
    expect(calls).toHaveLength(0);
  });

  it("different channels do not interfere — each gets its own window", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "ChanOne",
      preview: "a",
    });
    throttle.enqueue({
      channelId: "c2",
      channelName: "ChanTwo",
      preview: "b",
    });
    // Each fires its own first-time notification.
    expect(calls).toHaveLength(2);
    // Push a second hold into c1 only.
    throttle.enqueue({
      channelId: "c1",
      channelName: "ChanOne",
      preview: "a2",
    });
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(30_001);
    // c1 fires an aggregate (count=2); c2 had only one hold so no aggregate.
    expect(calls).toHaveLength(3);
    expect(calls[2].title).toBe("2 held messages on ChanOne");
  });

  it("__flushForTesting clears pending timers without firing", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "a",
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "b",
    });
    expect(calls).toHaveLength(1);
    throttle.__flushForTesting();
    vi.advanceTimersByTime(60_000);
    // Aggregate timer was cancelled — count stays at 1.
    expect(calls).toHaveLength(1);
  });

  it("reopens a fresh window after a previous one closed", () => {
    const { Ctor, calls } = makeMockNotification("granted");
    const throttle = new OSNotificationThrottle({
      windowMs: 30_000,
      notificationCtor: Ctor,
    });
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "first",
    });
    vi.advanceTimersByTime(30_001);
    // Window closed; no aggregate fired (only 1 hold). Next enqueue should
    // start a new window and fire immediately again.
    throttle.enqueue({
      channelId: "c1",
      channelName: "Streamer",
      preview: "second",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].title).toBe("Held message on Streamer");
    expect(calls[1].body).toBe("second");
  });
});
