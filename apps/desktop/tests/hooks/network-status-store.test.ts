import { afterEach, describe, expect, it, vi } from "vitest";

import { createNetworkStatusStore } from "@/hooks/network-status-store";

// Guards: failed end-to-end probes retry after 5s, 10s, 15s, then every 30s without stopping.
describe("network status retry loop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the required capped retry schedule forever", async () => {
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue(false);
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
      readBrowserOnline: () => true,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot()).toMatchObject({
        status: "offline",
        retryInSeconds: 5,
      });

      for (const [elapsedMs, callCount, nextSeconds] of [
        [5_000, 2, 10],
        [10_000, 3, 15],
        [15_000, 4, 30],
        [30_000, 5, 30],
        [30_000, 6, 30],
      ] as const) {
        await vi.advanceTimersByTimeAsync(elapsedMs);
        expect(probe).toHaveBeenCalledTimes(callCount);
        expect(store.getSnapshot().retryInSeconds).toBe(nextSeconds);
      }
    } finally {
      unsubscribe();
    }
  });

  it("treats a browser online event as a probe hint, not proof of internet access", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    let resolveRecovery!: (reachable: boolean) => void;
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveRecovery = resolve)));
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
      readBrowserOnline: () => true,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot().status).toBe("offline");

      events.dispatchEvent(new Event("online"));
      expect(store.getSnapshot().status).toBe("offline");

      resolveRecovery(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({
        status: "online",
        recoveryCount: 1,
        nextRetryAt: null,
      });
    } finally {
      unsubscribe();
    }
  });

  it("coalesces concurrent checks into one main-process probe", async () => {
    let resolveProbe!: (reachable: boolean) => void;
    const probe = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveProbe = resolve))
    );
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
      readBrowserOnline: () => true,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      const first = store.checkNow();
      const second = store.checkNow();
      expect(second).toBe(first);
      expect(probe).toHaveBeenCalledTimes(1);

      resolveProbe(true);
      await expect(first).resolves.toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("keeps confirmed offline state visible while a scheduled probe is checking", async () => {
    vi.useFakeTimers();
    let resolveRetry!: (reachable: boolean) => void;
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveRetry = resolve)));
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
      readBrowserOnline: () => true,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(store.getSnapshot()).toMatchObject({
        status: "offline",
        confirmedStatus: "offline",
        isOffline: true,
        isChecking: true,
        retryInSeconds: null,
      });

      resolveRetry(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({
        status: "offline",
        isOffline: true,
        isChecking: false,
        retryInSeconds: 10,
      });
    } finally {
      unsubscribe();
    }
  });

  it("queues one fresh probe when browser online fires during an outage probe", async () => {
    let resolveFirst!: (reachable: boolean) => void;
    let resolveSecond!: (reachable: boolean) => void;
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveSecond = resolve)));
    const events = new EventTarget();
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
      readBrowserOnline: () => false,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      const first = store.checkNow();
      events.dispatchEvent(new Event("online"));
      events.dispatchEvent(new Event("online"));
      expect(probe).toHaveBeenCalledTimes(1);

      resolveFirst(false);
      await expect(first).resolves.toBe(false);
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);

      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);
      resolveSecond(true);
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("does not let a stale probe consume the current probe's queued online hint", async () => {
    let resolveA!: (reachable: boolean) => void;
    let resolveB!: (reachable: boolean) => void;
    let resolveC!: (reachable: boolean) => void;
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveA = resolve)))
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveB = resolve)))
      .mockReturnValueOnce(new Promise<boolean>((resolve) => (resolveC = resolve)));
    const events = new EventTarget();
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
      readBrowserOnline: () => true,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      expect(probe).toHaveBeenCalledTimes(1); // A
      events.dispatchEvent(new Event("offline"));
      events.dispatchEvent(new Event("online"));
      expect(probe).toHaveBeenCalledTimes(2); // B
      events.dispatchEvent(new Event("online")); // queue a fresh probe after B

      resolveA(false); // stale A must not clear B's queued hint
      await Promise.resolve();
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);

      resolveB(false);
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(3)); // C starts immediately

      resolveC(true);
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
    }
  });
});
