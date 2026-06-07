import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/backend/logging/logger";
import type { PlatformHealthEvent } from "@/backend/api/unified/platform-health";

const TEST_TELEMETRY_DIR = "/tmp/test-telemetry";

vi.mock("@/backend/logging/log-paths", () => ({
  getTelemetryDir: vi.fn(() => TEST_TELEMETRY_DIR),
}));

describe("platform-health-telemetry", () => {
  let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let subscribedListener: ((event: PlatformHealthEvent) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:34:56.789Z"));

    appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => "" as any);

    subscribedListener = null;
    vi.doMock("@/backend/api/unified/platform-health", () => ({
      onPlatformHealthChanged: vi.fn((listener: (event: PlatformHealthEvent) => void) => {
        subscribedListener = listener;
        return () => { subscribedListener = null; };
      }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadModule() {
    return await import("@/backend/logging/platform-health-telemetry");
  }

  it("writes one JSONL line on a degraded transition", async () => {
    await loadModule();
    expect(subscribedListener).not.toBeNull();

    subscribedListener!({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 10,
      failureRate: 0.65,
    });

    expect(appendFileSyncSpy).toHaveBeenCalledOnce();
    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.ts).toBe("2026-06-07T12:34:56.789Z");
    expect(parsed.platform).toBe("kick");
    expect(parsed.fromState).toBe("healthy");
    expect(parsed.toState).toBe("degraded");
    expect(parsed.sampleSize).toBe(10);
    expect(parsed.failureRate).toBe(0.65);
    expect(parsed.source).toBe("internal");
  });

  it("tracks fromState correctly across multiple transitions", async () => {
    await loadModule();

    subscribedListener!({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 10,
      failureRate: 0.65,
    });

    subscribedListener!({
      platform: "kick",
      status: "healthy",
      startedAt: Date.now(),
      sampleSize: 12,
      failureRate: 0.2,
    });

    expect(appendFileSyncSpy).toHaveBeenCalledTimes(2);
    const first = JSON.parse((appendFileSyncSpy.mock.calls[0][1] as string).trim());
    const second = JSON.parse((appendFileSyncSpy.mock.calls[1][1] as string).trim());

    expect(first.fromState).toBe("healthy");
    expect(first.toState).toBe("degraded");

    expect(second.fromState).toBe("degraded");
    expect(second.toState).toBe("healthy");
  });

  it("logs a warn on write failure but does not throw", async () => {
    appendFileSyncSpy.mockImplementation(() => {
      throw new Error("disk full");
    });

    await loadModule();

    expect(() => {
      subscribedListener!({
        platform: "kick",
        status: "degraded",
        startedAt: Date.now(),
        sampleSize: 10,
        failureRate: 0.65,
      });
    }).not.toThrow();

    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("does not create the file until the first transition (lazy creation)", async () => {
    await loadModule();

    expect(appendFileSyncSpy).not.toHaveBeenCalled();
    expect(mkdirSyncSpy).not.toHaveBeenCalled();
  });

  it("writes valid JSON with all documented fields on each line", async () => {
    await loadModule();

    subscribedListener!({
      platform: "twitch",
      status: "down",
      startedAt: Date.now(),
      sampleSize: 5,
      failureRate: 1.0,
    });

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);

    const parsed = JSON.parse(written.trim());
    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("platform");
    expect(parsed).toHaveProperty("fromState");
    expect(parsed).toHaveProperty("toState");
    expect(parsed).toHaveProperty("sampleSize");
    expect(parsed).toHaveProperty("failureRate");
    expect(parsed).toHaveProperty("source");
  });

  it("writes to the telemetry directory from log-paths", async () => {
    await loadModule();

    subscribedListener!({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 10,
      failureRate: 0.65,
    });

    const filePath = appendFileSyncSpy.mock.calls[0][0] as string;
    expect(filePath).toBe(path.join(TEST_TELEMETRY_DIR, "platform-health.jsonl"));
  });

  it("creates the telemetry directory on first write", async () => {
    await loadModule();

    subscribedListener!({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 10,
      failureRate: 0.65,
    });

    expect(mkdirSyncSpy).toHaveBeenCalledWith(TEST_TELEMETRY_DIR, { recursive: true });
  });

  it("tracks platforms independently", async () => {
    await loadModule();

    subscribedListener!({
      platform: "kick",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 10,
      failureRate: 0.65,
    });

    subscribedListener!({
      platform: "twitch",
      status: "degraded",
      startedAt: Date.now(),
      sampleSize: 8,
      failureRate: 0.7,
    });

    const first = JSON.parse((appendFileSyncSpy.mock.calls[0][1] as string).trim());
    const second = JSON.parse((appendFileSyncSpy.mock.calls[1][1] as string).trim());

    expect(first.platform).toBe("kick");
    expect(first.fromState).toBe("healthy");

    expect(second.platform).toBe("twitch");
    expect(second.fromState).toBe("healthy");
  });
});
