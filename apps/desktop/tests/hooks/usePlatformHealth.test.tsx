import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

type PlatformHealthApi = ReturnType<typeof installElectronAPIMock>["platformHealth"];
type PlatformHealthSnapshot = Awaited<ReturnType<PlatformHealthApi["get"]>>;
type PlatformHealthEvent = Parameters<Parameters<PlatformHealthApi["onChange"]>[0]>[0];

function healthEvent(overrides: Partial<PlatformHealthEvent>): PlatformHealthEvent {
  return {
    platform: "kick",
    status: "healthy",
    startedAt: Date.now(),
    sampleSize: 10,
    failureRate: 0,
    source: "internal",
    ...overrides,
  };
}

// Hook test for the renderer-side `usePlatformHealth` (PRD #50 slice 01).
// Covers: initial hydration via `electronAPI.platformHealth.get()`, IPC
// transition handling via `onChange`, the derived `anyDegraded` flag, and
// unsubscribe on unmount.

describe("usePlatformHealth", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns healthy for both platforms before hydration completes", async () => {
    const api = installElectronAPIMock();
    let resolveGet: ((value: PlatformHealthSnapshot) => void) | null = null;
    api.platformHealth = {
      get: vi.fn(
        () =>
          new Promise<PlatformHealthSnapshot>((resolve) => {
            resolveGet = resolve;
          })
      ),
      onChange: vi.fn(() => () => {}),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    expect(result.current.kick).toBe("healthy");
    expect(result.current.twitch).toBe("healthy");
    expect(result.current.anyDegraded).toBe(false);
    expect(result.current.details).toEqual({});

    // Unblock the get so React doesn't warn about pending state.
    await act(async () => {
      resolveGet?.({ kick: "healthy", twitch: "healthy" });
    });
  });

  it("hydrates the initial state from electronAPI.platformHealth.get()", async () => {
    const api = installElectronAPIMock();
    api.platformHealth = {
      get: vi.fn(async (): Promise<PlatformHealthSnapshot> => ({
        kick: "degraded",
        twitch: "healthy",
      })),
      onChange: vi.fn(() => () => {}),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(result.current.kick).toBe("degraded"));
    expect(result.current.twitch).toBe("healthy");
    expect(result.current.anyDegraded).toBe(true);
  });

  it("updates state when an onChange event arrives", async () => {
    const api = installElectronAPIMock();
    let changeHandler: ((event: PlatformHealthEvent) => void) | null = null;
    api.platformHealth = {
      get: vi.fn(async (): Promise<PlatformHealthSnapshot> => ({
        kick: "healthy",
        twitch: "healthy",
      })),
      onChange: vi.fn((cb: typeof changeHandler) => {
        changeHandler = cb;
        return () => {};
      }),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(api.platformHealth.get).toHaveBeenCalled());

    act(() => {
      changeHandler?.(healthEvent({ status: "degraded" }));
    });

    expect(result.current.kick).toBe("degraded");
    expect(result.current.twitch).toBe("healthy");
    expect(result.current.anyDegraded).toBe(true);
  });

  it("stores status-page details from hydration and onChange events", async () => {
    const api = installElectronAPIMock();
    let changeHandler: ((event: PlatformHealthEvent) => void) | null = null;
    api.platformHealth = {
      get: vi.fn(async (): Promise<PlatformHealthSnapshot> => ({
        kick: "degraded",
        twitch: "healthy",
        details: { kick: { summary: "Kick status: Partial outage." } },
      })),
      onChange: vi.fn((cb: typeof changeHandler) => {
        changeHandler = cb;
        return () => {};
      }),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    await waitFor(() =>
      expect(result.current.details.kick?.summary).toBe("Kick status: Partial outage.")
    );

    act(() => {
      changeHandler?.(
        healthEvent({
          platform: "kick",
          status: "degraded",
          startedAt: Date.now(),
          statusPageDetail: { summary: "Kick status: Major outage." },
        })
      );
    });

    expect(result.current.details.kick?.summary).toBe("Kick status: Major outage.");

    act(() => {
      changeHandler?.(healthEvent({ status: "healthy" }));
    });

    expect(result.current.details.kick).toBeUndefined();
  });

  it("derives anyDegraded=true when EITHER platform is degraded", async () => {
    const api = installElectronAPIMock();
    api.platformHealth = {
      get: vi.fn(async (): Promise<PlatformHealthSnapshot> => ({
        kick: "healthy",
        twitch: "degraded",
      })),
      onChange: vi.fn(() => () => {}),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(result.current.anyDegraded).toBe(true));
    expect(result.current.kick).toBe("healthy");
    expect(result.current.twitch).toBe("degraded");
  });

  it("calls the unsubscribe function returned by onChange on unmount", async () => {
    const api = installElectronAPIMock();
    const unsubscribe = vi.fn();
    api.platformHealth = {
      get: vi.fn(async (): Promise<PlatformHealthSnapshot> => ({
        kick: "healthy",
        twitch: "healthy",
      })),
      onChange: vi.fn(() => unsubscribe),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { unmount } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(api.platformHealth.onChange).toHaveBeenCalled());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
