import { describe, expect, it } from "vitest";
import { isAbsolute, join } from "node:path";

import {
  DEFAULT_SOAK_OPTIONS,
  analyzeSoakSamples,
  parseSoakArguments,
  resolveSoakOutputPath,
} from "../../scripts/performance-soak.mjs";

// Guards: the unattended soak command rejects invalid timing and threshold inputs before opening Electron.
// Guards: stable native memory, renderer heap, CPU, frames, process count, exceptions, and 429s produce a passing report.
// Guards: sustained memory growth and quota violations fail with machine-readable reason codes.
// Guards: a throttled renderer cannot hang the unattended runner and fails with an explicit frame-sample timeout.
describe("performance soak gate", () => {
  it("parses an explicit multi-day run without weakening default thresholds", () => {
    const options = parseSoakArguments([
      "--",
      "--duration-minutes",
      "2880",
      "--sample-seconds",
      "30",
      "--warmup-minutes",
      "5",
      "--route-cycle-seconds",
      "1800",
      "--output",
      ".audit/soak.json",
    ]);

    expect(options).toMatchObject({
      durationMs: 2 * 24 * 60 * 60_000,
      sampleIntervalMs: 30_000,
      warmupMs: 5 * 60_000,
      routeCycleMs: 30 * 60_000,
      outputPath: ".audit/soak.json",
      maxResidentGrowthBytes: DEFAULT_SOAK_OPTIONS.maxResidentGrowthBytes,
      maxRateLimitedResponses: 0,
    });
  });

  it("rejects a warmup that consumes the run", () => {
    expect(() =>
      parseSoakArguments(["--duration-seconds", "30", "--warmup-seconds", "30"])
    ).toThrow("Warmup must be shorter");
  });

  it("resolves relative reports into the repository audit directory", () => {
    const outputPath = resolveSoakOutputPath(".audit/soak.json");

    expect(isAbsolute(outputPath)).toBe(true);
    expect(outputPath.endsWith(join(".audit", "soak.json"))).toBe(true);
  });

  it("passes a stable post-warmup run", () => {
    const startedAt = Date.parse("2026-08-25T18:00:00.000Z");
    const result = analyzeSoakSamples({
      startedAt,
      endedAt: startedAt + 40_000,
      options: {
        ...DEFAULT_SOAK_OPTIONS,
        durationMs: 40_000,
        warmupMs: 10_000,
      },
      events: [],
      samples: [0, 10, 20, 30, 40].map((seconds, index) => ({
        observedAtMs: startedAt + seconds * 1000,
        route: "#/",
        cpuPercent: 0.4 + index * 0.1,
        residentMemoryBytes: (800 + index * 2) * 1024 * 1024,
        processCount: 5,
        rendererHeapBytes: (60 + index) * 1024 * 1024,
        frameP95Ms: 16.8,
        frameMaxMs: 17,
        frameSampleTimedOut: false,
        videoCount: 1,
        playingVideoCount: 1,
        domNodeCount: 1200,
      })),
    });

    expect(result.verdict).toBe("pass");
    expect(result.failures).toEqual([]);
    expect(result.summary.stableSampleCount).toBe(4);
  });

  it("fails sustained memory growth, exceptions, and rate limiting", () => {
    const startedAt = Date.parse("2026-08-25T18:00:00.000Z");
    const result = analyzeSoakSamples({
      startedAt,
      endedAt: startedAt + 40_000,
      options: {
        ...DEFAULT_SOAK_OPTIONS,
        durationMs: 40_000,
        warmupMs: 0,
        maxResidentGrowthBytes: 20 * 1024 * 1024,
      },
      events: [
        { kind: "renderer-exception", observedAtMs: startedAt + 1, description: "boom" },
        { kind: "http-429", observedAtMs: startedAt + 2, url: "https://example.test" },
      ],
      samples: [0, 10, 20, 30, 40].map((seconds, index) => ({
        observedAtMs: startedAt + seconds * 1000,
        route: "#/",
        cpuPercent: 1,
        residentMemoryBytes: (700 + index * 25) * 1024 * 1024,
        processCount: 5,
        rendererHeapBytes: 60 * 1024 * 1024,
        frameP95Ms: 16.8,
        frameMaxMs: 17,
        frameSampleTimedOut: index === 4,
        videoCount: 1,
        playingVideoCount: 1,
        domNodeCount: 1200,
      })),
    });

    expect(result.verdict).toBe("fail");
    expect(result.failures).toEqual([
      "resident-memory-growth",
      "frame-sample-timeout",
      "renderer-exceptions",
      "http-429",
    ]);
  });
});
