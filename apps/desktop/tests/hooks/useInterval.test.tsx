import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "@/hooks/useInterval";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useInterval", () => {
  it("calls the callback every `delay` ms", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does not schedule anything when delay is null", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, null));
    act(() => vi.advanceTimersByTime(10000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("calls the latest callback without re-arming the interval", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useInterval(cb, 1000), {
      initialProps: { cb: cb1 },
    });
    rerender({ cb: cb2 });
    act(() => vi.advanceTimersByTime(1000));
    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("stops firing after unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useInterval(cb, 1000));
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
