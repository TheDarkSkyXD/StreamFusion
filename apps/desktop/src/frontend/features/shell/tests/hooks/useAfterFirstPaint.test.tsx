import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";

// Guards: an occluded Electron window must not leave deferred stream chat and related content blank forever.
describe("useAfterFirstPaint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("MODE", "production");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("releases deferred content when animation frames are suspended", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(17);

    const { result } = renderHook(() => useAfterFirstPaint());
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(250));

    expect(result.current).toBe(true);
  });
});
