import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHelixPoll } from "@/hooks/useHelixPoll";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  setVisibility("visible");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHelixPoll", () => {
  it("fires the fetcher once immediately on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    renderHook(() =>
      useHelixPoll({ fetcher, intervalMs: 5000, enabled: true }),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fires at the requested interval", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    renderHook(() =>
      useHelixPoll({ fetcher, intervalMs: 1000, enabled: true }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not poll while enabled=false", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    renderHook(() =>
      useHelixPoll({ fetcher, intervalMs: 1000, enabled: false }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("pauses while document.visibilityState === 'hidden' and resumes when visible", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    renderHook(() =>
      useHelixPoll({ fetcher, intervalMs: 1000, enabled: true }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Go hidden — interval should not call the fetcher.
    await act(async () => {
      setVisibility("hidden");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Back to visible — immediate fetch + interval resumes.
    await act(async () => {
      setVisibility("visible");
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refresh() triggers an out-of-band fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() =>
      useHelixPoll({ fetcher, intervalMs: 10_000, enabled: true }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
