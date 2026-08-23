import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

// Guards: app-level offline state comes from a main-process reachability probe rather than navigator.onLine alone.
// Guards: the debug console can simulate offline UI without changing the confirmed connectivity state.
describe("useNetworkStatus", () => {
  beforeEach(() => {
    vi.resetModules();
    setOnline(true);
  });

  it("reports offline when the browser has a network link but the internet probe fails", async () => {
    const api = installElectronAPIMock();
    api.connectivity.check = vi.fn(async () => ({ reachable: false }));
    const { useNetworkStatus } = await import("@/hooks/useNetworkStatus");

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current).toMatchObject({
      status: "offline",
      confirmedStatus: "offline",
      isOnline: false,
      retryInSeconds: 5,
    });
  });

  it("allows the debug console to simulate offline UI and then reset to confirmed state", async () => {
    const api = installElectronAPIMock();
    api.connectivity.check = vi.fn(async () => ({ reachable: true }));
    const { setNetworkStatusOverrideForDebug, useNetworkStatus } =
      await import("@/hooks/useNetworkStatus");
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.confirmedStatus).toBe("online"));

    act(() => setNetworkStatusOverrideForDebug(false));
    expect(result.current).toMatchObject({
      status: "offline",
      confirmedStatus: "online",
      isOnline: false,
      isOffline: true,
    });

    act(() => setNetworkStatusOverrideForDebug(null));
    expect(result.current).toMatchObject({
      status: "online",
      confirmedStatus: "online",
      isOnline: true,
      isOffline: false,
    });
  });
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}
