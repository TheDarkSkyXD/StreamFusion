import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "@/hooks/useTimeout";

// Guards: callback identity changes must NOT re-arm the timer — the ref pattern is the load-bearing optimization
// Guards: delay=null pauses the timer (does not schedule a 0ms callback)
describe("useTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the LATEST callback after delay (stable ref — does not re-arm on callback identity change)", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useTimeout(cb, 1000),
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    vi.advanceTimersByTime(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("delay=null does not schedule the callback", () => {
    const cb = vi.fn();
    renderHook(() => useTimeout(cb, null));
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });
});
