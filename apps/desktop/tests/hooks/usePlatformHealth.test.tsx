import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

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
    let resolveGet: ((value: { kick: string; twitch: string }) => void) | null = null;
    api.platformHealth = {
      get: vi.fn(
        () =>
          new Promise<{ kick: string; twitch: string }>((resolve) => {
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

    // Unblock the get so React doesn't warn about pending state.
    await act(async () => {
      resolveGet?.({ kick: "healthy", twitch: "healthy" });
    });
  });

  it("hydrates the initial state from electronAPI.platformHealth.get()", async () => {
    const api = installElectronAPIMock();
    api.platformHealth = {
      get: vi.fn(async () => ({ kick: "degraded", twitch: "healthy" })),
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
    let changeHandler:
      | ((event: { platform: string; status: string; startedAt: number }) => void)
      | null = null;
    api.platformHealth = {
      get: vi.fn(async () => ({ kick: "healthy", twitch: "healthy" })),
      onChange: vi.fn((cb: typeof changeHandler) => {
        changeHandler = cb;
        return () => {};
      }),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { result } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(api.platformHealth.get).toHaveBeenCalled());

    act(() => {
      changeHandler?.({ platform: "kick", status: "degraded", startedAt: Date.now() });
    });

    expect(result.current.kick).toBe("degraded");
    expect(result.current.twitch).toBe("healthy");
    expect(result.current.anyDegraded).toBe(true);
  });

  it("derives anyDegraded=true when EITHER platform is degraded", async () => {
    const api = installElectronAPIMock();
    api.platformHealth = {
      get: vi.fn(async () => ({ kick: "healthy", twitch: "degraded" })),
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
      get: vi.fn(async () => ({ kick: "healthy", twitch: "healthy" })),
      onChange: vi.fn(() => unsubscribe),
    };

    const { usePlatformHealth } = await import("@/hooks/usePlatformHealth");
    const { unmount } = renderHook(() => usePlatformHealth());

    await waitFor(() => expect(api.platformHealth.onChange).toHaveBeenCalled());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
