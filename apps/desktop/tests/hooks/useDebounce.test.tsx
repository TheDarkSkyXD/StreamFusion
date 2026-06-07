import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebounce } from "@/hooks/useDebounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebounce", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("does not update until the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a");
  });

  it("updates after the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("b");
  });

  it("resets the timer on every value change (only the last value wins)", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ v: "c" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("c");
  });

  it("cleans up the timer on unmount", () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe("a");
  });

  it("works with non-string types", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: 1 },
    });
    rerender({ v: 42 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(42);
  });
});
