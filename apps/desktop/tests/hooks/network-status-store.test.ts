import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ConnectivityObservation,
  createNetworkStatusStore,
} from "@/hooks/network-status-store";

const observation = (online: boolean): ConnectivityObservation => ({
  status: online ? "online" : "offline",
});

// Guards: confirmed physical disconnection retries after 5s, 10s, 15s, then every 30s.
describe("network status retry loop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the required capped retry schedule forever", async () => {
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue(observation(false));
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
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

  it("treats a browser online event as a hint, not proof of physical connectivity", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    let resolveRecovery!: (value: ConnectivityObservation) => void;
    const probe = vi
      .fn<() => Promise<ConnectivityObservation>>()
      .mockResolvedValueOnce(observation(false))
      .mockReturnValueOnce(
        new Promise<ConnectivityObservation>((resolve) => (resolveRecovery = resolve))
      );
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot().status).toBe("offline");

      events.dispatchEvent(new Event("online"));
      expect(store.getSnapshot().status).toBe("offline");

      resolveRecovery(observation(true));
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

  it("waits for the main-process result before treating a browser offline event as confirmed", async () => {
    let resolveProbe!: (value: ConnectivityObservation) => void;
    const events = new EventTarget();
    const probe = vi
      .fn<() => Promise<ConnectivityObservation>>()
      .mockResolvedValueOnce(observation(true))
      .mockReturnValueOnce(
        new Promise<ConnectivityObservation>((resolve) => (resolveProbe = resolve))
      );
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(store.getSnapshot().status).toBe("online"));

      events.dispatchEvent(new Event("offline"));
      expect(store.getSnapshot().status).toBe("online");

      resolveProbe(observation(false));
      await vi.waitFor(() => expect(store.getSnapshot().status).toBe("offline"));
    } finally {
      unsubscribe();
    }
  });

  it("coalesces concurrent checks into one main-process probe", async () => {
    let resolveProbe!: (value: ConnectivityObservation) => void;
    const probe = vi.fn(
      () => new Promise<ConnectivityObservation>((resolve) => (resolveProbe = resolve))
    );
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      const first = store.checkNow();
      const second = store.checkNow();
      expect(second).toBe(first);
      expect(probe).toHaveBeenCalledTimes(1);

      resolveProbe(observation(true));
      await expect(first).resolves.toEqual(observation(true));
    } finally {
      unsubscribe();
    }
  });

  it("keeps confirmed offline state visible while a scheduled probe is checking", async () => {
    vi.useFakeTimers();
    let resolveRetry!: (value: ConnectivityObservation) => void;
    const probe = vi
      .fn<() => Promise<ConnectivityObservation>>()
      .mockResolvedValueOnce(observation(false))
      .mockReturnValueOnce(
        new Promise<ConnectivityObservation>((resolve) => (resolveRetry = resolve))
      );
    const store = createNetworkStatusStore({
      probe,
      eventTarget: new EventTarget(),
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

      resolveRetry(observation(false));
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
    let resolveFirst!: (value: ConnectivityObservation) => void;
    let resolveSecond!: (value: ConnectivityObservation) => void;
    const probe = vi
      .fn<() => Promise<ConnectivityObservation>>()
      .mockReturnValueOnce(
        new Promise<ConnectivityObservation>((resolve) => (resolveFirst = resolve))
      )
      .mockReturnValueOnce(
        new Promise<ConnectivityObservation>((resolve) => (resolveSecond = resolve))
      );
    const events = new EventTarget();
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      const first = store.checkNow();
      events.dispatchEvent(new Event("online"));
      events.dispatchEvent(new Event("online"));
      expect(probe).toHaveBeenCalledTimes(1);

      resolveFirst(observation(false));
      await expect(first).resolves.toEqual(observation(false));
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);

      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);
      resolveSecond(observation(true));
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("coalesces browser hints without losing a recheck requested during the next probe", async () => {
    let resolveA!: (value: ConnectivityObservation) => void;
    let resolveB!: (value: ConnectivityObservation) => void;
    let resolveC!: (value: ConnectivityObservation) => void;
    const probe = vi
      .fn<() => Promise<ConnectivityObservation>>()
      .mockReturnValueOnce(new Promise<ConnectivityObservation>((resolve) => (resolveA = resolve)))
      .mockReturnValueOnce(new Promise<ConnectivityObservation>((resolve) => (resolveB = resolve)))
      .mockReturnValueOnce(new Promise<ConnectivityObservation>((resolve) => (resolveC = resolve)));
    const events = new EventTarget();
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      expect(probe).toHaveBeenCalledTimes(1); // A
      events.dispatchEvent(new Event("offline"));
      events.dispatchEvent(new Event("online"));
      expect(probe).toHaveBeenCalledTimes(1);

      resolveA(observation(false));
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2)); // B
      events.dispatchEvent(new Event("online")); // queue a fresh probe after B

      resolveB(observation(false));
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(3)); // C starts immediately

      resolveC(observation(true));
      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
    }
  });
});
