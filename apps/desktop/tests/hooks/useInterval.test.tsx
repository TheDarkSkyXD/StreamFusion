import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "@/hooks/useInterval";

// Guards: changing the callback prop must NOT re-arm the interval — the ref pattern is the load-bearing optimization (regression class: timer thrash on every render)
// Guards: delay=null pauses the interval (does not schedule a 0ms tick)
describe("useInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the LATEST callback on every tick (stable ref — does not clear/re-arm on callback identity change)", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useInterval(cb, 100),
      { initialProps: { cb: first } },
    );

    vi.advanceTimersByTime(100);
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second });
    vi.advanceTimersByTime(300);

    // first should not be called again; second receives the next three ticks.
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(3);
  });

  it("delay=null pauses (no tick fires)", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, null));
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });
});
