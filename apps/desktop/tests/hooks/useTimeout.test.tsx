import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "@/hooks/useTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTimeout", () => {
  it("fires the callback once after `delay` ms", () => {
    const cb = vi.fn();
    renderHook(() => useTimeout(cb, 500));
    act(() => vi.advanceTimersByTime(499));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(1); // one-shot
  });

  it("never fires when delay is null", () => {
    const cb = vi.fn();
    renderHook(() => useTimeout(cb, null));
    act(() => vi.advanceTimersByTime(10000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("re-arms with the new delay (cancelling the old timer) when delay changes", () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ d }) => useTimeout(cb, d), {
      initialProps: { d: 1000 as number | null },
    });
    act(() => vi.advanceTimersByTime(500)); // t=500; old timer would fire at t=1000
    rerender({ d: 2000 }); // delay changed: cancel old, arm new (fires at t=2500)
    act(() => vi.advanceTimersByTime(700)); // t=1200, past the old timer's fire time
    expect(cb).toHaveBeenCalledTimes(0); // old timer was cancelled
    act(() => vi.advanceTimersByTime(1300)); // t=2500
    expect(cb).toHaveBeenCalledTimes(1); // new timer fired
  });

  it("does not fire after unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useTimeout(cb, 1000));
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
