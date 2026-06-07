import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// State-machine tests for the per-Platform health tracker (slice 01 of the
// platform-outage handling feature). Covers trip-to-degraded, the failure
// class exclusion list, Kick/Twitch isolation, and listener emission.
// `down` transitions arrive in slice 05 — not exercised here.

describe("platform-health (slice 01: trip to degraded)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts every platform in the healthy state", async () => {
    const { getPlatformHealth, isPlatformHealthy } = await import(
      "@/backend/api/unified/platform-health"
    );

    expect(getPlatformHealth("kick")).toBe("healthy");
    expect(getPlatformHealth("twitch")).toBe("healthy");
    expect(isPlatformHealthy("kick")).toBe(true);
    expect(isPlatformHealthy("twitch")).toBe(true);
  });

  it("flips kick to degraded after 60% failure rate over the minimum sample (≥8)", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    // 6 timeouts + 4 successes = 60% over 10 samples (≥ DEGRADED_MIN_SAMPLE=8).
    for (let i = 0; i < 6; i++) recordPlatformFailure("kick", "timeout");
    for (let i = 0; i < 4; i++) recordPlatformSuccess("kick");

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("stays healthy under the failure-rate threshold even with many samples", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Interleaved 1-fail / 2-success pattern keeps failure rate at ~33%
    // throughout the trajectory — well under the 60% trip threshold.
    for (let i = 0; i < 6; i++) {
      recordPlatformFailure("kick", "timeout");
      recordPlatformSuccess("kick");
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("stays healthy below the minimum sample size even at 100% failure rate", async () => {
    const { getPlatformHealth, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    // 7 consecutive failures, no successes — below the 8-sample minimum.
    for (let i = 0; i < 7; i++) recordPlatformFailure("kick", "timeout");

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("counts all three failure classes (timeout, server-5xx, net-error) the same way", async () => {
    const { getPlatformHealth, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Mix of all three classes — 8 total failures at 100% rate trips.
    recordPlatformFailure("kick", "timeout");
    recordPlatformFailure("kick", "timeout");
    recordPlatformFailure("kick", "timeout");
    recordPlatformFailure("kick", "server-5xx");
    recordPlatformFailure("kick", "server-5xx");
    recordPlatformFailure("kick", "server-5xx");
    recordPlatformFailure("kick", "net-error");
    recordPlatformFailure("kick", "net-error");

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("isolates Kick failures from Twitch state (bulkhead)", async () => {
    const { getPlatformHealth, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Trip Kick hard.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    // Twitch untouched — must remain healthy.
    expect(getPlatformHealth("twitch")).toBe("healthy");
  });

  it("isolates Twitch failures from Kick state (reverse bulkhead)", async () => {
    const { getPlatformHealth, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("twitch", "timeout");
    expect(getPlatformHealth("twitch")).toBe("degraded");
    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("ages outcomes out of the rolling window after 60s", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    // 4 failures at t=0 (sample size below trip floor, healthy).
    for (let i = 0; i < 4; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("healthy");

    // 61s later, the old failures have aged out of the 60s window. 5 fresh
    // successes alone shouldn't reach the 8-sample minimum and shouldn't
    // trip anything.
    vi.advanceTimersByTime(61_000);
    for (let i = 0; i < 5; i++) recordPlatformSuccess("kick");
    expect(getPlatformHealth("kick")).toBe("healthy");
  });
});

describe("platform-health (slice 01: transition listener)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onPlatformHealthChanged with { platform, status, startedAt } on the healthy→degraded transition", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; startedAt: number }> = [];
    const unsubscribe = onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
    });

    unsubscribe();
  });

  it("does not fire while the state stays healthy", async () => {
    const { onPlatformHealthChanged, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: unknown[] = [];
    onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 20; i++) recordPlatformSuccess("kick");

    expect(events).toHaveLength(0);
  });

  it("does not re-fire while already degraded (only fires on transition)", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: unknown[] = [];
    onPlatformHealthChanged((e) => events.push(e));

    // Trip to degraded.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(events).toHaveLength(1);

    // More failures while already degraded — no additional events.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(events).toHaveLength(1);
  });

  it("unsubscribe removes the listener", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: unknown[] = [];
    const unsubscribe = onPlatformHealthChanged((e) => events.push(e));
    unsubscribe();

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(events).toHaveLength(0);
  });
});

describe("platform-health (slice 02: degraded → healthy recovery)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers to healthy after 30s of <40% failure rate within the rolling window", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Trip to degraded: 8 timeouts at 100% rate.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    // Drive 30s of healthy traffic at well under 40% (one failure mixed in
    // with many successes), with the final sample at t=30s.
    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("does NOT recover when sustained failure rate stays at or above 40% (hysteresis)", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Trip to degraded.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    // 30s of 50% failure rate — above the 40% recovery threshold, so the
    // state must stay degraded. One failure + one success per second.
    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      if (elapsed % 2000 === 0) {
        recordPlatformFailure("kick", "timeout");
      } else {
        recordPlatformSuccess("kick");
      }
    }

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("requires a CONTINUOUS 30s recovery window — 15s good + 15s bad does not recover", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    const startedAt = Date.now();

    // 15s of 0% failure (all successes).
    for (let elapsed = 1000; elapsed <= 15_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(getPlatformHealth("kick")).toBe("degraded");

    // 15s of 100% failure — pushes failure rate back over the threshold
    // before any 30s-continuous window has elapsed.
    for (let elapsed = 16_000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformFailure("kick", "timeout");
    }

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("fires onPlatformHealthChanged with { platform, status: 'healthy', startedAt } on recovery", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; startedAt: number }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("degraded");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      platform: "kick",
      status: "healthy",
      startedAt: Date.now(),
    });
  });

  it("does not re-emit recovery events while already healthy", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: unknown[] = [];
    onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(events).toHaveLength(2);

    // More successes after recovery — no additional events.
    for (let i = 0; i < 20; i++) recordPlatformSuccess("kick");
    expect(events).toHaveLength(2);
  });

  it("can re-trip from healthy → degraded after a recovery cycle", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess, ROLLING_WINDOW_MS } =
      await import("@/backend/api/unified/platform-health");

    // Trip.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    // Recover.
    const recoveryStart = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(recoveryStart + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(getPlatformHealth("kick")).toBe("healthy");

    // Jump past the rolling window so the old recovery successes age out.
    vi.setSystemTime(new Date(recoveryStart + 30_000 + ROLLING_WINDOW_MS + 1000));

    // Re-trip with a fresh failure burst.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");
  });
});
