import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

// Guards: app-level offline state comes only from a confirmed main-process physical connectivity observation.
// Guards: an IPC failure cannot masquerade as physical internet loss while the app was online.
// Guards: the debug console can simulate offline UI without changing the confirmed connectivity state.
describe("useNetworkStatus", () => {
  beforeEach(() => {
    vi.resetModules();
    setOnline(true);
  });

  it("reports offline when the main process confirms physical disconnection", async () => {
    const api = installElectronAPIMock();
    api.connectivity.check = vi.fn(async () => ({ status: "offline" as const }));
    const { useNetworkStatus } = await import("@/features/settings/data/useNetworkStatus");

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current).toMatchObject({
      status: "offline",
      confirmedStatus: "offline",
      isOnline: false,
      retryInSeconds: 5,
    });
  });

  it("stays online when the connectivity IPC request rejects", async () => {
    const api = installElectronAPIMock();
    api.connectivity.check = vi
      .fn()
      .mockResolvedValueOnce({ status: "online" as const })
      .mockRejectedValueOnce(new Error("connectivity handler unavailable"));
    const { useNetworkStatus } = await import("@/features/settings/data/useNetworkStatus");

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.status).toBe("online"));
    await act(() => result.current.checkNow());
    expect(result.current.isOffline).toBe(false);
    expect(result.current.confirmedStatus).toBe("online");
  });

  it("allows the debug console to simulate offline UI and then reset to confirmed state", async () => {
    const api = installElectronAPIMock();
    api.connectivity.check = vi.fn(async () => ({ status: "online" as const }));
    const { setNetworkStatusOverrideForDebug, useNetworkStatus } =
      await import("@/features/settings/data/useNetworkStatus");
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
