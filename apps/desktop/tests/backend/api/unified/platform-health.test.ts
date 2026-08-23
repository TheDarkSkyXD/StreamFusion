import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cross-logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from "@/lib/cross-logger";

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
    expect(events[0]).toMatchObject({
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
    expect(events[1]).toMatchObject({
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

describe("platform-health (slice 04: transition logging)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.debug).mockClear();
    vi.mocked(logger.info).mockClear();
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs one warn on healthy→degraded with failure counts", async () => {
    const { recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 6; i++) recordPlatformFailure("kick", "timeout");
    for (let i = 0; i < 4; i++) recordPlatformSuccess("kick");

    const warnCalls = vi.mocked(logger.warn).mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toMatch(/kick degraded: \d+\/\d+ requests failed/);
  });

  it("logs one warn on degraded→healthy with duration", async () => {
    const { recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    vi.mocked(logger.warn).mockClear();

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    const warnCalls = vi.mocked(logger.warn).mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toMatch(/kick recovered after 30s/);
  });

  it("does NOT log while staying healthy", async () => {
    const { recordPlatformSuccess } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 20; i++) recordPlatformSuccess("kick");

    const warnCalls = vi.mocked(logger.warn).mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls).toHaveLength(0);
  });

  it("does NOT log while staying degraded (only the transition warn)", async () => {
    const { recordPlatformFailure } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const warnCalls1 = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls1).toHaveLength(1);

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const warnCalls2 = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls2).toHaveLength(1);
  });
});

describe("platform-health (slice 05: down state)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    vi.mocked(logger.warn).mockClear();
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recordPlatformLocalNetError called 3+ times in 2s transitions to down", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");

    expect(getPlatformHealth("kick")).toBe("down");
  });

  it("state stays down for at least 3s after the last burst error", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(getPlatformHealth("kick")).toBe("down");

    // Still down at 2999ms
    vi.advanceTimersByTime(2999);
    expect(getPlatformHealth("kick")).toBe("down");
  });

  it("down self-clears after 3s when failure rate is low (to healthy)", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(getPlatformHealth("kick")).toBe("down");

    // After 3001ms, down expires. No high failure-rate signal, so -> healthy.
    vi.advanceTimersByTime(3001);
    // Need to trigger an evaluation by recording something or calling get.
    // getPlatformHealth should check expiry.
    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("down self-clears to degraded when failure rate is still high", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Build up failure-rate signal first (8 failures at 100% = degraded-worthy).
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    // That tripped to degraded. Now pile on a net-error burst to go down.
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(getPlatformHealth("kick")).toBe("down");

    // After 3s, down expires. But failure rate is still high => degraded.
    vi.advanceTimersByTime(3001);
    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("down takes precedence over degraded", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    // Trip to degraded first.
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    // Now trigger down.
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(getPlatformHealth("kick")).toBe("down");
  });

  it("isPlatformHealthy returns false for down", async () => {
    const { isPlatformHealthy, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");

    expect(isPlatformHealthy("kick")).toBe(false);
  });

  it("recordPlatformCrash immediately transitions to down", async () => {
    const { getPlatformHealth, recordPlatformCrash } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformCrash("kick");
    expect(getPlatformHealth("kick")).toBe("down");
  });

  it("logs the crash source when recordPlatformCrash transitions to down", async () => {
    const { recordPlatformCrash } = await import("@/backend/api/unified/platform-health");

    recordPlatformCrash("kick", "network-service-gone");

    expect(logger.warn).toHaveBeenCalledWith(
      "PlatformHealth",
      expect.stringContaining("Chromium NetworkService crash detected")
    );
  });

  it("does not re-fire event if already down", async () => {
    const { onPlatformHealthChanged, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("down");

    // More errors while already down should not fire again.
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(events).toHaveLength(1);
  });

  it("fires onPlatformHealthChanged with status: 'down' on transition", async () => {
    const { onPlatformHealthChanged, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; startedAt: number }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "kick",
      status: "down",
      startedAt: Date.now(),
    });
  });

  it("ignores non-burst errors (fewer than 3)", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("ignores errors spread beyond 2s window", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    vi.advanceTimersByTime(1500);
    recordPlatformLocalNetError("kick");
    vi.advanceTimersByTime(1500);
    recordPlatformLocalNetError("kick");

    // The first error aged out of the 2s window, so only 2 in window.
    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("logs one warn per down transition", async () => {
    const { recordPlatformLocalNetError } = await import("@/backend/api/unified/platform-health");

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");

    const warnCalls = vi.mocked(logger.warn).mock.calls.filter(([tag]) => tag === "PlatformHealth");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toMatch(/kick down.*local network crash/i);
  });

  it("down extends downUntil on each new error (rolling 3s)", async () => {
    const { getPlatformHealth, recordPlatformLocalNetError } = await import(
      "@/backend/api/unified/platform-health"
    );

    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    recordPlatformLocalNetError("kick");
    expect(getPlatformHealth("kick")).toBe("down");

    // Advance 2s, fire another error, extending downUntil by 3s from now.
    vi.advanceTimersByTime(2000);
    recordPlatformLocalNetError("kick");

    // At t=2s+2999ms = t=4999ms, still down (downUntil was refreshed at t=2000).
    vi.advanceTimersByTime(2999);
    expect(getPlatformHealth("kick")).toBe("down");

    // At t=5001ms, 3001ms after last error at t=2000, should clear.
    vi.advanceTimersByTime(2);
    expect(getPlatformHealth("kick")).toBe("healthy");
  });
});

describe("platform-health (slice 10: emitted events include sampleSize and failureRate)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes sampleSize and failureRate on healthy->degraded event", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    type HealthEvent = Parameters<Parameters<typeof onPlatformHealthChanged>[0]>[0];
    const events: HealthEvent[] = [];
    onPlatformHealthChanged((event) => events.push(event));

    for (let i = 0; i < 6; i++) recordPlatformFailure("kick", "timeout");
    for (let i = 0; i < 4; i++) recordPlatformSuccess("kick");

    expect(events).toHaveLength(1);
    expect(events[0].sampleSize).toBe(8);
    expect(events[0].failureRate).toBe(0.75);
  });

  it("includes sampleSize and failureRate on degraded->healthy recovery event", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    type HealthEvent = Parameters<Parameters<typeof onPlatformHealthChanged>[0]>[0];
    const events: HealthEvent[] = [];
    onPlatformHealthChanged((event) => events.push(event));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(events).toHaveLength(1);

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(events).toHaveLength(2);
    expect(events[1].sampleSize).toBeGreaterThan(0);
    expect(events[1].failureRate).toBeLessThan(0.4);
  });
});

describe("platform-health (slice 06: Twitch instrumentation isolation)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Twitch degraded state does not affect Kick state", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("twitch", "server-5xx");
    expect(getPlatformHealth("twitch")).toBe("degraded");

    for (let i = 0; i < 10; i++) recordPlatformSuccess("kick");
    expect(getPlatformHealth("kick")).toBe("healthy");

    expect(getPlatformHealth("twitch")).toBe("degraded");
  });

  it("Kick degraded state does not affect Twitch state", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    for (let i = 0; i < 10; i++) recordPlatformSuccess("twitch");
    expect(getPlatformHealth("twitch")).toBe("healthy");

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("both platforms can be degraded independently", async () => {
    const { getPlatformHealth, recordPlatformFailure } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("twitch", "server-5xx");
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "net-error");

    expect(getPlatformHealth("twitch")).toBe("degraded");
    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("one platform can recover while the other stays degraded", async () => {
    const { getPlatformHealth, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    for (let i = 0; i < 8; i++) recordPlatformFailure("twitch", "server-5xx");
    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("twitch")).toBe("degraded");
    expect(getPlatformHealth("kick")).toBe("degraded");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("twitch");
    }
    expect(getPlatformHealth("twitch")).toBe("healthy");
    expect(getPlatformHealth("kick")).toBe("degraded");
  });
});

describe("platform-health (slice 08: status-page signal nudges recovery cooldown)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    const { __resetPlatformHealthForTests } = await import("@/backend/api/unified/platform-health");
    __resetPlatformHealthForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("all-clear shortens recovery cooldown to 15s", async () => {
    const {
      getPlatformHealth,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
    } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    recordStatusPageSignal("kick", "all-clear");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 15_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("confirmed-outage extends recovery cooldown to 60s", async () => {
    const {
      getPlatformHealth,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
    } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    recordStatusPageSignal("kick", "confirmed-outage");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("degraded");
  });

  it("confirmed-outage allows recovery after 60s", async () => {
    const {
      getPlatformHealth,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
    } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    recordStatusPageSignal("kick", "confirmed-outage");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 60_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("no-signal uses the default 30s cooldown", async () => {
    const {
      getPlatformHealth,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
    } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    recordStatusPageSignal("kick", "no-signal");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("status-page signal is cleared on recovery", async () => {
    const {
      getPlatformHealth,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
      ROLLING_WINDOW_MS,
    } = await import("@/backend/api/unified/platform-health");

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    recordStatusPageSignal("kick", "all-clear");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 15_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(getPlatformHealth("kick")).toBe("healthy");

    vi.setSystemTime(new Date(startedAt + 15_000 + ROLLING_WINDOW_MS + 1000));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    expect(getPlatformHealth("kick")).toBe("degraded");

    const retrippedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 15_000; elapsed += 1000) {
      vi.setSystemTime(new Date(retrippedAt + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(getPlatformHealth("kick")).toBe("degraded");

    for (let elapsed = 16_000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(retrippedAt + elapsed));
      recordPlatformSuccess("kick");
    }
    expect(getPlatformHealth("kick")).toBe("healthy");
  });

  it("confirmed status-page outage causes healthy-to-degraded transition", async () => {
    const { getPlatformHealth, onPlatformHealthChanged, recordStatusPageSignal } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; source?: string }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    recordStatusPageSignal("kick", "confirmed-outage", {
      summary: "Kick status: Partial outage - KICK Degraded Functionality.",
      impact: "Partial outage",
      headline: "KICK Degraded Functionality",
    });
    expect(getPlatformHealth("kick")).toBe("degraded");

    const degradedEvent = events.find((e) => e.platform === "kick" && e.status === "degraded");
    expect(degradedEvent).toBeDefined();
    expect(degradedEvent!.source).toBe("status-page");
    expect(degradedEvent).toMatchObject({
      statusPageDetail: {
        summary: "Kick status: Partial outage - KICK Degraded Functionality.",
      },
    });
  });

  it("marks Kick degraded immediately when official API app-token auth fails", async () => {
    const { getPlatformHealth, onPlatformHealthChanged, recordPlatformOfficialApiAuthFailure } =
      await import("@/backend/api/unified/platform-health");

    const events: Array<{ platform: string; status: string }> = [];
    onPlatformHealthChanged((event) => events.push(event));

    recordPlatformOfficialApiAuthFailure("kick", 401);

    expect(getPlatformHealth("kick")).toBe("degraded");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ platform: "kick", status: "degraded" });
  });

  it("status-page detail updates emit another degraded event", async () => {
    const { onPlatformHealthChanged, recordStatusPageSignal } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{
      platform: string;
      status: string;
      statusPageDetail?: { summary: string };
    }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    recordStatusPageSignal("kick", "confirmed-outage", {
      summary: "Kick status: Partial outage - KICK Degraded Functionality.",
      impact: "Partial outage",
    });
    recordStatusPageSignal("kick", "confirmed-outage", {
      summary: "Kick status: Major outage - KICK Outage.",
      impact: "Major outage",
    });

    const degradedEvents = events.filter((e) => e.platform === "kick" && e.status === "degraded");
    expect(degradedEvents).toHaveLength(2);
    expect(degradedEvents[1].statusPageDetail?.summary).toBe(
      "Kick status: Major outage - KICK Outage."
    );
  });

  it("all-clear recovers a status-page-created degradation", async () => {
    const { getPlatformHealth, onPlatformHealthChanged, recordStatusPageSignal } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; source?: string }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    recordStatusPageSignal("kick", "confirmed-outage");
    recordStatusPageSignal("kick", "all-clear");

    expect(getPlatformHealth("kick")).toBe("healthy");

    const recoveryEvent = events.find((e) => e.platform === "kick" && e.status === "healthy");
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent!.source).toBe("status-page");
  });

  it("recovery event includes source: 'status-page' when signal was active", async () => {
    const {
      onPlatformHealthChanged,
      recordPlatformFailure,
      recordPlatformSuccess,
      recordStatusPageSignal,
    } = await import("@/backend/api/unified/platform-health");

    const events: Array<{ platform: string; status: string; source?: string }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");
    recordStatusPageSignal("kick", "all-clear");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 15_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    const recoveryEvent = events.find((e) => e.status === "healthy");
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent!.source).toBe("status-page");
  });

  it("recovery event includes source: 'internal' when no signal was active", async () => {
    const { onPlatformHealthChanged, recordPlatformFailure, recordPlatformSuccess } = await import(
      "@/backend/api/unified/platform-health"
    );

    const events: Array<{ platform: string; status: string; source?: string }> = [];
    onPlatformHealthChanged((e) => events.push(e));

    for (let i = 0; i < 8; i++) recordPlatformFailure("kick", "timeout");

    const startedAt = Date.now();
    for (let elapsed = 1000; elapsed <= 30_000; elapsed += 1000) {
      vi.setSystemTime(new Date(startedAt + elapsed));
      recordPlatformSuccess("kick");
    }

    const recoveryEvent = events.find((e) => e.status === "healthy");
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent!.source).toBe("internal");
  });
});
