import { describe, expect, it } from "vitest";

import { createForegroundCapabilityProfileSampler } from "../components/foreground-capability-profile-sampler";

describe("Foreground capability profile sampler", () => {
  it("runs one foreground sample at a time and slows its next sample while degraded", async () => {
    let resolveSample: ((stage: 0 | 1 | 2 | 3 | 4 | 5) => void) | undefined;
    const scheduled: { callback: () => void; delayMs: number; token: number }[] = [];
    const cancelled: number[] = [];
    let runCount = 0;
    let onForegroundChange: ((foreground: boolean) => void) | undefined;
    let removed = false;
    const sampler = createForegroundCapabilityProfileSampler({
      cancel: (timer) => cancelled.push(timer),
      degradedIntervalMs: 120_000,
      isForeground: () => true,
      normalIntervalMs: 30_000,
      runSample: () => {
        runCount += 1;
        return new Promise((resolve) => {
          resolveSample = resolve;
        });
      },
      schedule: (callback, delayMs) => {
        const token = scheduled.length + 1;
        scheduled.push({ callback, delayMs, token });
        return token;
      },
      subscribe: (listener) => {
        onForegroundChange = listener;
        return { remove: () => { removed = true; } };
      },
    });

    sampler.start();
    sampler.start();
    expect(runCount).toBe(1);
    resolveSample?.(4);
    await Promise.resolve();
    expect(scheduled).toEqual([{ callback: expect.any(Function), delayMs: 120_000, token: 1 }]);

    scheduled[0]?.callback();
    expect(runCount).toBe(2);
    onForegroundChange?.(false);
    expect(cancelled).toEqual([1]);
    resolveSample?.(0);
    await Promise.resolve();
    expect(scheduled).toHaveLength(1);

    sampler.dispose();
    expect(removed).toBe(true);
  });

  it("stops foreground work on background and starts a fresh sample after foregrounding", async () => {
    let foreground = true;
    let onForegroundChange: ((foreground: boolean) => void) | undefined;
    let runCount = 0;
    const sampler = createForegroundCapabilityProfileSampler({
      cancel: () => undefined,
      degradedIntervalMs: 120_000,
      isForeground: () => foreground,
      normalIntervalMs: 30_000,
      runSample: async () => {
        runCount += 1;
        return 0;
      },
      schedule: () => 1,
      subscribe: (listener) => {
        onForegroundChange = listener;
        return { remove: () => undefined };
      },
    });

    sampler.start();
    await Promise.resolve();
    foreground = false;
    onForegroundChange?.(false);
    foreground = true;
    onForegroundChange?.(true);
    await Promise.resolve();
    expect(runCount).toBe(2);
    sampler.dispose();
  });

  it("coalesces repeated retry requests and does not sample while backgrounded or disposed", async () => {
    let foreground = true;
    let resolveSample: ((stage: 0 | 1 | 2 | 3 | 4 | 5) => void) | undefined;
    let runs = 0;
    let acceptedStarts = 0;
    let onForegroundChange: ((foreground: boolean) => void) | undefined;
    const sampler = createForegroundCapabilityProfileSampler({
      cancel: () => undefined,
      degradedIntervalMs: 120_000,
      isForeground: () => foreground,
      normalIntervalMs: 30_000,
      onSampleStart: () => { acceptedStarts += 1; },
      runSample: () => {
        runs += 1;
        return new Promise((resolve) => { resolveSample = resolve; });
      },
      schedule: () => 1,
      subscribe: (listener) => {
        onForegroundChange = listener;
        return { remove: () => undefined };
      },
    });

    sampler.start();
    sampler.refresh();
    sampler.refresh();
    expect(runs).toBe(1);
    expect(acceptedStarts).toBe(1);
    resolveSample?.(0);
    await Promise.resolve();
    foreground = false;
    onForegroundChange?.(false);
    sampler.refresh();
    expect(runs).toBe(1);
    expect(acceptedStarts).toBe(1);
    sampler.dispose();
    foreground = true;
    sampler.refresh();
    expect(runs).toBe(1);
    expect(acceptedStarts).toBe(1);
  });
});
