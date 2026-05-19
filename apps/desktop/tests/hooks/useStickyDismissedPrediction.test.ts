import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStickyDismissedPrediction } from "@/hooks/useStickyDismissedPrediction";

describe("useStickyDismissedPrediction", () => {
  it("accepts every prediction id until one is dismissed", () => {
    const { result } = renderHook(() => useStickyDismissedPrediction());
    expect(result.current.shouldSuppress("pred-1")).toBe(false);
    expect(result.current.shouldSuppress("pred-1")).toBe(false);
    expect(result.current.shouldSuppress("pred-2")).toBe(false);
  });

  it("suppresses subsequent updates for the same dismissed id", () => {
    const { result } = renderHook(() => useStickyDismissedPrediction());
    act(() => {
      result.current.dismiss("pred-1");
    });
    expect(result.current.shouldSuppress("pred-1")).toBe(true);
    expect(result.current.shouldSuppress("pred-1")).toBe(true);
  });

  it("clears the dismiss when a new prediction id arrives", () => {
    const { result } = renderHook(() => useStickyDismissedPrediction());
    act(() => {
      result.current.dismiss("pred-1");
    });
    // New id slips through and clears the gate.
    expect(result.current.shouldSuppress("pred-2")).toBe(false);
    // Old id is no longer suppressed (a fresh emission of pred-1 would render).
    expect(result.current.shouldSuppress("pred-1")).toBe(false);
  });

  it("returns stable callback identities across renders", () => {
    const { result, rerender } = renderHook(() => useStickyDismissedPrediction());
    const firstShouldSuppress = result.current.shouldSuppress;
    const firstDismiss = result.current.dismiss;
    rerender();
    expect(result.current.shouldSuppress).toBe(firstShouldSuppress);
    expect(result.current.dismiss).toBe(firstDismiss);
  });
});
