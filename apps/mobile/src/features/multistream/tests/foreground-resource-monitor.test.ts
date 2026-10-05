import { afterEach, describe, expect, it, vi } from "vitest";
import { createForegroundMultistreamResourceMonitor } from "../adapters/foreground-resource-monitor";

afterEach(() => vi.useRealTimers());

describe("Multistream foreground resource monitor", () => {
  it("samples every 30 seconds only while foregrounded and releases its timer", async () => {
    vi.useFakeTimers();
    let foreground = true;
    let notify: ((active: boolean) => void) | null = null;
    const samples: number[] = [];
    const monitor = createForegroundMultistreamResourceMonitor({
      isForeground: () => foreground,
      subscribe(listener) {
        notify = listener;
        return () => {
          notify = null;
        };
      },
    });
    const release = monitor.subscribe(async () => {
      samples.push(samples.length + 1);
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(samples).toEqual([1]);
    foreground = false;
    notify?.(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(samples).toEqual([1]);
    foreground = true;
    notify?.(true);
    await Promise.resolve();
    expect(samples).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(samples).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(1);
    release();
    expect(vi.getTimerCount()).toBe(0);
    monitor.dispose();
  });
});
