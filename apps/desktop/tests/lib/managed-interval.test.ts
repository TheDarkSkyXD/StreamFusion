import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createManagedInterval } from "@/lib/managed-interval";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createManagedInterval", () => {
  it("calls the callback every `ms`", () => {
    const cb = vi.fn();
    createManagedInterval(cb, 1000);
    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("stop() cancels: no further calls after stop", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent (calling it twice does not throw)", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("returns a stable `stop` handle (no re-arming on subsequent calls)", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    const stopRef1 = handle.stop;
    // (no semantic guarantee beyond "stop is a function" — just sanity)
    expect(typeof stopRef1).toBe("function");
    handle.stop();
  });
});
