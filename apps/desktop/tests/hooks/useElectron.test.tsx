import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAppVersion,
  useAppVersionInfo,
  useOpenExternal,
  useWindowControls,
} from "@/features/settings/data/useElectron";

beforeEach(() => {
  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue("1.2.3"),
    getVersionInfo: vi.fn().mockResolvedValue({
      version: "1.2.3-beta.1",
      isPrerelease: true,
      channel: "beta",
      displayVersion: "1.2.3 (Beta)",
    }),
    getSystemTheme: vi.fn().mockResolvedValue("dark"),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChange: vi.fn(() => vi.fn()),
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    openExternal: vi.fn(),
    showNotification: vi.fn(),
    store: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      delete: vi.fn(),
    },
  };
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

describe("useAppVersion", () => {
  it("returns the version from electronAPI", async () => {
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current).toBe("1.2.3"));
  });

  it("returns null when electronAPI is not available", async () => {
    // @ts-expect-error -- clean up
    delete window.electronAPI;
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBeNull();
  });
});

describe("useAppVersionInfo", () => {
  it("returns extended version info", async () => {
    const { result } = renderHook(() => useAppVersionInfo());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.isPrerelease).toBe(true);
    expect(result.current!.channel).toBe("beta");
  });
});

describe("useWindowControls", () => {
  it("returns initial isMaximized state from electronAPI", async () => {
    const { result } = renderHook(() => useWindowControls());
    await waitFor(() => expect(window.electronAPI!.isMaximized).toHaveBeenCalled());
    expect(result.current.isMaximized).toBe(false);
  });

  it("subscribes to maximize changes and cleans up on unmount", async () => {
    const unsubscribe = vi.fn();
    window.electronAPI!.onMaximizeChange = vi.fn(() => unsubscribe);

    const { unmount } = renderHook(() => useWindowControls());
    await waitFor(() => expect(window.electronAPI!.onMaximizeChange).toHaveBeenCalled());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("minimize calls electronAPI.minimizeWindow", () => {
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.minimize());
    expect(window.electronAPI!.minimizeWindow).toHaveBeenCalledTimes(1);
  });

  it("maximize calls electronAPI.maximizeWindow", () => {
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.maximize());
    expect(window.electronAPI!.maximizeWindow).toHaveBeenCalledTimes(1);
  });

  it("close calls electronAPI.closeWindow", () => {
    const { result } = renderHook(() => useWindowControls());
    act(() => result.current.close());
    expect(window.electronAPI!.closeWindow).toHaveBeenCalledTimes(1);
  });
});

describe("useOpenExternal", () => {
  it("returns a function that calls electronAPI.openExternal", () => {
    const { result } = renderHook(() => useOpenExternal());
    act(() => result.current("https://example.com"));
    expect(window.electronAPI!.openExternal).toHaveBeenCalledWith("https://example.com");
  });
});
