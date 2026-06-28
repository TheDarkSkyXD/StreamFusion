import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

// Guards: app-level offline state follows browser online/offline transitions so outage UI does not depend on platform API failures.
describe("useNetworkStatus", () => {
  beforeEach(() => {
    setOnline(true);
  });

  it("returns offline when the browser reports the app is offline", async () => {
    setOnline(false);
    const { useNetworkStatus } = await import("@/hooks/useNetworkStatus");

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toEqual({ isOnline: false, isOffline: true });
  });

  it("updates when the browser moves offline and back online", async () => {
    const { useNetworkStatus } = await import("@/hooks/useNetworkStatus");
    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOnline).toBe(true);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toEqual({ isOnline: false, isOffline: true });

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toEqual({ isOnline: true, isOffline: false });
  });

  it("allows the debug console to simulate offline UI and then reset to browser state", async () => {
    const { setNetworkStatusOverrideForDebug, useNetworkStatus } = await import(
      "@/hooks/useNetworkStatus"
    );
    const { result } = renderHook(() => useNetworkStatus());

    act(() => setNetworkStatusOverrideForDebug(false));
    expect(result.current).toEqual({ isOnline: false, isOffline: true });

    act(() => setNetworkStatusOverrideForDebug(null));
    expect(result.current).toEqual({ isOnline: true, isOffline: false });
  });
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}
