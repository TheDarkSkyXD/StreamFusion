import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("kick-network-health", () => {
  let acquireKickRequestSlot: typeof import("@backend/api/platforms/kick/kick-network-health").acquireKickRequestSlot;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import("@backend/api/platforms/kick/kick-network-health");
    acquireKickRequestSlot = mod.acquireKickRequestSlot;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("acquireKickRequestSlot — semaphore (max 4)", () => {
    it("immediately resolves when slots are available", async () => {
      const release = await acquireKickRequestSlot();
      expect(typeof release).toBe("function");
      release();
    });

    it("allows up to 4 concurrent slots", async () => {
      const releases: Array<() => void> = [];
      for (let i = 0; i < 4; i++) {
        releases.push(await acquireKickRequestSlot());
      }
      expect(releases).toHaveLength(4);
      for (const r of releases) r();
    });

    it("queues the 5th caller until a slot is released", async () => {
      const releases: Array<() => void> = [];
      for (let i = 0; i < 4; i++) {
        releases.push(await acquireKickRequestSlot());
      }

      let fifthResolved = false;
      const fifthPromise = acquireKickRequestSlot().then((release) => {
        fifthResolved = true;
        return release;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fifthResolved).toBe(false);

      releases[0]();
      const fifthRelease = await fifthPromise;
      expect(fifthResolved).toBe(true);
      fifthRelease();
    });

    it("hands the slot to the next waiter on release without changing total in-flight", async () => {
      const releases: Array<() => void> = [];
      for (let i = 0; i < 4; i++) {
        releases.push(await acquireKickRequestSlot());
      }

      const waiterPromise = acquireKickRequestSlot();
      releases[0]();
      const waiterRelease = await waiterPromise;

      let anotherResolved = false;
      const anotherPromise = acquireKickRequestSlot().then((r) => {
        anotherResolved = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(anotherResolved).toBe(false);

      waiterRelease();
      const anotherRelease = await anotherPromise;
      anotherRelease();
      for (let i = 1; i < releases.length; i++) releases[i]();
    });
  });
});
