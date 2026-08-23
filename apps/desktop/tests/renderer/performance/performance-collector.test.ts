import {
  createPerformanceCollector,
  isPerformanceHarnessRequested,
} from "@/renderer/performance/performance-collector";
import { describe, expect, it } from "vitest";

// Guards: performance scenarios report useful frame percentiles and jank counts without retaining an unbounded session history.
describe("performance collector", () => {
  it("is passive unless the explicit performance query flag is present", () => {
    expect(isPerformanceHarnessRequested("?perf=1")).toBe(true);
    expect(isPerformanceHarnessRequested("?perf=0")).toBe(false);
    expect(isPerformanceHarnessRequested("")).toBe(false);
  });

  it("summarizes a bounded window of frame intervals", () => {
    const collector = createPerformanceCollector({ maxSamples: 4 });

    collector.startScenario("chat-burst");
    [10, 17, 34, 60, 20].forEach((duration) => collector.recordFrame(duration));

    expect(collector.snapshot()).toMatchObject({
      name: "chat-burst",
      frames: {
        count: 4,
        p50Ms: 20,
        p95Ms: 60,
        p99Ms: 60,
        maxMs: 60,
        over16Ms: 4,
        over33Ms: 2,
        over50Ms: 1,
      },
    });
  });

  it("bounds long tasks and resets every scenario measurement", () => {
    const collector = createPerformanceCollector({ maxSamples: 2 });

    collector.startScenario("route-change");
    collector.recordLongTask({ startTime: 10, duration: 55 });
    collector.recordLongTask({ startTime: 20, duration: 75 });
    collector.recordLongTask({ startTime: 30, duration: 95 });

    expect(collector.snapshot().longTasks).toEqual([
      { startTime: 20, duration: 75 },
      { startTime: 30, duration: 95 },
    ]);

    collector.reset();
    expect(collector.snapshot()).toMatchObject({ name: null, longTasks: [], frames: { count: 0 } });
  });

  it("reports video milestones and dropped-frame deltas from the scenario start", () => {
    let now = 1_000;
    const collector = createPerformanceCollector({ now: () => now });

    collector.startScenario("twitch-player");
    now = 1_120;
    collector.recordVideoEvent("loadedmetadata");
    now = 1_450;
    collector.recordVideoEvent("playing");
    collector.recordVideoQuality({ totalVideoFrames: 100, droppedVideoFrames: 2 });
    collector.recordVideoQuality({ totalVideoFrames: 220, droppedVideoFrames: 5 });

    expect(collector.snapshot().video).toMatchObject({
      milestones: { loadedmetadataMs: 120, playingMs: 450 },
      totalFrames: 120,
      droppedFrames: 3,
      droppedFrameRatio: 0.025,
    });
  });

  it("records completed route presentation timings without leaking pending routes", () => {
    let now = 100;
    const collector = createPerformanceCollector({ now: () => now });
    collector.startScenario("navigation");

    collector.recordRouteStart("#/following");
    now = 142;
    collector.recordRoutePresented("#/following");
    collector.recordRoutePresented("#/unknown");

    expect(collector.snapshot().routes).toEqual([{ hash: "#/following", durationMs: 42 }]);
  });
});
