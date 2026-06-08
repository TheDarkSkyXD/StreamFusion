/**
 * process-monitor.test.ts
 *
 * Two layers under test:
 *
 *   - `formatSnapshot` — pure formatter. The on-disk shape must match Valo's
 *     `[ProcessMonitor]` body verbatim ("rss=161MB heap=22MB/24MB cpu=0% load=0.0/0.0/0.0").
 *     Rounding rules (MB nearest int, CPU% nearest int, load to 1 decimal)
 *     are pinned here so callers can rely on the line being grep-stable.
 *   - `startProcessMonitor` — the scheduler. Driven through `vi.useFakeTimers`
 *     so we never wait real wall-clock seconds. We assert: no log on the same
 *     tick as start, exactly one log per interval boundary, stop is idempotent,
 *     and a second start auto-clears the first interval (so we don't accumulate
 *     duplicate ticks). The logger is mocked at the module boundary; we never
 *     touch electron-log here.
 */
import type { ProcessMetric } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type ProcessMonitorModule = typeof import("@/backend/logging/process-monitor");
type LoggerModule = typeof import("@/backend/logging/logger");

async function freshModule(): Promise<{
  pm: ProcessMonitorModule;
  loggerMock: LoggerModule;
}> {
  vi.resetModules();
  const pm = await import("@/backend/logging/process-monitor");
  const loggerMock = await import("@/backend/logging/logger");
  return { pm, loggerMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// formatSnapshot — pure formatter
// ---------------------------------------------------------------------------

describe("formatSnapshot", () => {
  it("matches Valo's reference line verbatim for the zero-CPU baseline", async () => {
    const { pm } = await freshModule();
    const body = pm.formatSnapshot({
      rssBytes: 161 * 1024 * 1024,
      heapUsedBytes: 22 * 1024 * 1024,
      heapTotalBytes: 24 * 1024 * 1024,
      cpuPercent: 0,
      load: [0, 0, 0],
    });
    expect(body).toBe("rss=161MB heap=22MB/24MB cpu=0% load=0.0/0.0/0.0");
  });

  it("rounds MB to the nearest integer (0.6MB -> 1MB)", async () => {
    const { pm } = await freshModule();
    const body = pm.formatSnapshot({
      rssBytes: Math.round(0.6 * 1024 * 1024),
      heapUsedBytes: 1 * 1024 * 1024,
      heapTotalBytes: 2 * 1024 * 1024,
      cpuPercent: 0,
      load: [0, 0, 0],
    });
    expect(body.startsWith("rss=1MB ")).toBe(true);
  });

  it("rounds MB to the nearest integer (0.4MB -> 0MB)", async () => {
    const { pm } = await freshModule();
    const body = pm.formatSnapshot({
      rssBytes: Math.round(0.4 * 1024 * 1024),
      heapUsedBytes: 1 * 1024 * 1024,
      heapTotalBytes: 2 * 1024 * 1024,
      cpuPercent: 0,
      load: [0, 0, 0],
    });
    expect(body.startsWith("rss=0MB ")).toBe(true);
  });

  it("rounds CPU% to the nearest integer (49.6 -> 50)", async () => {
    const { pm } = await freshModule();
    const body = pm.formatSnapshot({
      rssBytes: 10 * 1024 * 1024,
      heapUsedBytes: 5 * 1024 * 1024,
      heapTotalBytes: 8 * 1024 * 1024,
      cpuPercent: 49.6,
      load: [0, 0, 0],
    });
    expect(body).toContain("cpu=50%");
  });

  it("formats each load value with one decimal place (1.234 -> 1.2)", async () => {
    const { pm } = await freshModule();
    const body = pm.formatSnapshot({
      rssBytes: 10 * 1024 * 1024,
      heapUsedBytes: 5 * 1024 * 1024,
      heapTotalBytes: 8 * 1024 * 1024,
      cpuPercent: 0,
      // Values chosen away from `.x5` tiebreaks — IEEE-754 representation of
      // half-decimals can round either way under toFixed(1), which is
      // irrelevant to the formatter's contract (1 decimal place).
      load: [1.234, 2.78, 0.91],
    });
    expect(body).toContain("load=1.2/2.8/0.9");
  });
});

// ---------------------------------------------------------------------------
// startProcessMonitor — scheduler integration via fake timers
// ---------------------------------------------------------------------------

describe("startProcessMonitor scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does NOT log immediately on start — first log is at the first tick boundary", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor({ intervalMs: 1000 });
    try {
      expect(loggerMock.logger.info).not.toHaveBeenCalled();
      vi.advanceTimersByTime(999);
      expect(loggerMock.logger.info).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(loggerMock.logger.info).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("calls logger.info once per tick with tag 'ProcessMonitor' (3 ticks -> 3 calls)", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor({ intervalMs: 500 });
    try {
      vi.advanceTimersByTime(1500);
      expect(loggerMock.logger.info).toHaveBeenCalledTimes(3);
      for (const call of (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call[0]).toBe("ProcessMonitor");
      }
    } finally {
      stop();
    }
  });

  it("body string starts with `rss=` and contains heap=, cpu=, load= substrings", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor({ intervalMs: 1000 });
    try {
      vi.advanceTimersByTime(1000);
      const calls = (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      const body = calls[0][1] as string;
      expect(body.startsWith("rss=")).toBe(true);
      expect(body).toContain("heap=");
      expect(body).toContain("cpu=");
      expect(body).toContain("load=");
    } finally {
      stop();
    }
  });

  it("stop function clears the interval — no further logs fire after stop", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor({ intervalMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(loggerMock.logger.info).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(loggerMock.logger.info).toHaveBeenCalledTimes(1);
  });

  it("stop is idempotent — calling twice does not throw", async () => {
    const { pm } = await freshModule();
    const stop = pm.startProcessMonitor({ intervalMs: 1000 });
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it("two consecutive starts do NOT double-log per tick — only the second interval is active", async () => {
    const { pm, loggerMock } = await freshModule();
    const firstStop = pm.startProcessMonitor({ intervalMs: 1000 });
    const secondStop = pm.startProcessMonitor({ intervalMs: 1000 });
    try {
      vi.advanceTimersByTime(1000);
      // Exactly one tick fired, not two — the first interval was auto-cleared
      // inside the second start.
      expect(loggerMock.logger.info).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(loggerMock.logger.info).toHaveBeenCalledTimes(3);
    } finally {
      // First stop is a no-op (interval already cleared); must not throw.
      firstStop();
      secondStop();
    }
  });

  it("defaults to a 30s interval when intervalMs is omitted", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor();
    try {
      vi.advanceTimersByTime(29_999);
      expect(loggerMock.logger.info).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(loggerMock.logger.info).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-process telemetry — `app.getAppMetrics()` is injected as `getAppMetrics`
// so we exercise the real format/append paths without a real Electron runtime.
// `workingSetSize` (KB) is the RSS source; utility names have whitespace
// collapsed so the line stays a single space-delimited token stream.
// ---------------------------------------------------------------------------

function fakeMetric(overrides: Partial<ProcessMetric>): ProcessMetric {
  return {
    pid: 0,
    type: "Browser",
    cpu: { percentCPUUsage: 0, idleWakeupsPerSecond: 0 },
    creationTime: 0,
    memory: { workingSetSize: 0, peakWorkingSetSize: 0 },
    ...overrides,
  } as ProcessMetric;
}

describe("per-process telemetry via injected getAppMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("includes the utility process name as a `:name` suffix so utility leaks are identifiable", async () => {
    const { pm, loggerMock } = await freshModule();
    const metrics: ProcessMetric[] = [
      fakeMetric({
        pid: 9001,
        type: "Utility",
        name: "Network Service",
        memory: { workingSetSize: 64 * 1024, peakWorkingSetSize: 64 * 1024 },
      }),
      // No name -> no trailing `:name` segment. Keeps the line compact for
      // Browser/Tab/GPU rows where the type already says everything.
      fakeMetric({
        pid: 9002,
        type: "GPU",
        memory: { workingSetSize: 50 * 1024, peakWorkingSetSize: 50 * 1024 },
      }),
    ];
    const stop = pm.startProcessMonitor({
      intervalMs: 1000,
      getAppMetrics: () => metrics,
    });
    try {
      vi.advanceTimersByTime(1000);
      const calls = (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls;
      const body = calls[0][1] as string;
      // Spaces inside the utility name are replaced with `_` so the segment
      // stays a single whitespace-delimited token — log scrapers split on
      // spaces, so an unescaped "Network Service" would corrupt the count.
      expect(body).toContain("9001:Utility:64:Network_Service");
      expect(body).toContain("9002:GPU:50");
      // Guard the no-name case: the GPU row must NOT have a trailing colon.
      expect(body).not.toContain("9002:GPU:50:");
    } finally {
      stop();
    }
  });

  it("emits procs=[] when getAppMetrics returns an empty array (e.g. pre-ready edge case)", async () => {
    const { pm, loggerMock } = await freshModule();
    const stop = pm.startProcessMonitor({
      intervalMs: 1000,
      getAppMetrics: () => [],
    });
    try {
      vi.advanceTimersByTime(1000);
      const body = (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(body).toContain("procs=[]");
    } finally {
      stop();
    }
  });

  it("does not crash the tick if getAppMetrics throws — emits procs=err and keeps ticking", async () => {
    const { pm, loggerMock } = await freshModule();
    let throwOnce = true;
    const stop = pm.startProcessMonitor({
      intervalMs: 1000,
      getAppMetrics: () => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("app not ready");
        }
        return [
          fakeMetric({
            pid: 7777,
            type: "Browser",
            memory: { workingSetSize: 100 * 1024, peakWorkingSetSize: 100 * 1024 },
          }),
        ];
      },
    });
    try {
      vi.advanceTimersByTime(1000);
      const calls = (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      const firstBody = calls[0][1] as string;
      expect(firstBody).toContain("procs=err:");
      // Next tick must still fire — failure was not allowed to clear the interval.
      vi.advanceTimersByTime(1000);
      expect(calls).toHaveLength(2);
      const secondBody = calls[1][1] as string;
      expect(secondBody).toContain("procs=[7777:Browser:100]");
    } finally {
      stop();
    }
  });

  it("appends a procs=[...] segment listing pid:type:rssMB for every metric returned", async () => {
    const { pm, loggerMock } = await freshModule();
    const metrics: ProcessMetric[] = [
      fakeMetric({
        pid: 1234,
        type: "Browser",
        // workingSetSize is in KB; 185 * 1024 KB = 185 MB.
        memory: { workingSetSize: 185 * 1024, peakWorkingSetSize: 200 * 1024 },
      }),
      fakeMetric({
        pid: 2345,
        type: "Tab",
        memory: { workingSetSize: 412 * 1024, peakWorkingSetSize: 450 * 1024 },
      }),
      fakeMetric({
        pid: 3456,
        type: "GPU",
        memory: { workingSetSize: 78 * 1024, peakWorkingSetSize: 90 * 1024 },
      }),
    ];
    const stop = pm.startProcessMonitor({
      intervalMs: 1000,
      getAppMetrics: () => metrics,
    });
    try {
      vi.advanceTimersByTime(1000);
      const calls = (loggerMock.logger.info as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      const body = calls[0][1] as string;
      // Existing prefix must remain — older scrapers still need rss/heap/cpu/load.
      expect(body.startsWith("rss=")).toBe(true);
      expect(body).toContain("heap=");
      expect(body).toContain("cpu=");
      expect(body).toContain("load=");
      // New per-process suffix.
      expect(body).toContain("procs=[1234:Browser:185 2345:Tab:412 3456:GPU:78]");
    } finally {
      stop();
    }
  });
});
