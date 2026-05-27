import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useManagedTimeout } from "@/hooks/useManagedTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useManagedTimeout", () => {
  it("fires `ms` after start()", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => vi.advanceTimersByTime(999));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("clear() cancels a pending timer", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => result.current.clear());
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("start() restarts without stacking (only the latest timer fires)", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.start(1000)); // re-arm before the first fires
    act(() => vi.advanceTimersByTime(999));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1); // exactly one fire, not two
  });

  it("uses the latest callback", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useManagedTimeout(cb), {
      initialProps: { cb: cb1 },
    });
    act(() => result.current.start(1000));
    rerender({ cb: cb2 });
    act(() => vi.advanceTimersByTime(1000));
    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("does not fire after unmount", () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("returns a referentially stable object across re-renders", () => {
    const { result, rerender } = renderHook(() => useManagedTimeout(vi.fn()));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
