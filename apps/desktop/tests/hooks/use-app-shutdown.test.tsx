import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAppShutdownTasks = vi.hoisted(() => vi.fn());

vi.mock("@/features/shell/utils/app-shutdown-registry", () => ({ runAppShutdownTasks }));

import { useAppShutdown } from "@/features/shell/data/use-app-shutdown";
import { useChatStore } from "@/store/chat-store";
import { installElectronAPIMock } from "../test-utils";

let onBeforeQuitCallback: (() => void) | null = null;
let previousElectronApiDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  onBeforeQuitCallback = null;
  previousElectronApiDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = installElectronAPIMock();
  electronApi.closeWindow = vi.fn();
  electronApi.onBeforeQuit = vi.fn((cb: () => void) => {
    onBeforeQuitCallback = cb;
    return vi.fn();
  });
  runAppShutdownTasks.mockReset();
});

afterEach(() => {
  if (previousElectronApiDescriptor) {
    Object.defineProperty(window, "electronAPI", previousElectronApiDescriptor);
  } else {
    Reflect.deleteProperty(window, "electronAPI");
  }
});

// Guards: the eager app root runs only cleanup registered by features that were actually loaded.
describe("useAppShutdown", () => {
  it("does nothing when the Electron bridge is unavailable", () => {
    Reflect.deleteProperty(window, "electronAPI");

    expect(() => renderHook(() => useAppShutdown())).not.toThrow();
    expect(runAppShutdownTasks).not.toHaveBeenCalled();
  });

  it("registers an onBeforeQuit listener on mount", () => {
    renderHook(() => useAppShutdown());
    expect(window.electronAPI!.onBeforeQuit).toHaveBeenCalledTimes(1);
  });

  it("runs cleanup registered by on-demand features", () => {
    renderHook(() => useAppShutdown());
    expect(onBeforeQuitCallback).not.toBeNull();
    onBeforeQuitCallback!();
    expect(runAppShutdownTasks).toHaveBeenCalledTimes(1);
  });

  it("sets window.__shuttingDown to true", () => {
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();
    expect(Reflect.get(window, "__shuttingDown")).toBe(true);
  });

  it("clears chat batching when shutdown begins", () => {
    const cleanupSpy = vi.spyOn(useChatStore.getState(), "cleanupBatching");
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    cleanupSpy.mockRestore();
  });

  it("acknowledges shutdown by closing after renderer cleanup", async () => {
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();

    await vi.waitFor(() => expect(window.electronAPI!.closeWindow).toHaveBeenCalledTimes(1));
  });

  it("still acknowledges shutdown when a feature cleanup throws", async () => {
    runAppShutdownTasks.mockImplementationOnce(() => {
      throw new Error("cleanup failed");
    });
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();

    await vi.waitFor(() => expect(window.electronAPI!.closeWindow).toHaveBeenCalledTimes(1));
  });

  it("still acknowledges shutdown when chat cleanup throws", () => {
    const cleanupSpy = vi
      .spyOn(useChatStore.getState(), "cleanupBatching")
      .mockImplementationOnce(() => {
        throw new Error("chat cleanup failed");
      });
    renderHook(() => useAppShutdown());

    expect(() => onBeforeQuitCallback!()).not.toThrow();
    expect(window.electronAPI!.closeWindow).toHaveBeenCalledTimes(1);
    cleanupSpy.mockRestore();
  });

  it("returns the cleanup function from onBeforeQuit", () => {
    const unsub = vi.fn();
    window.electronAPI!.onBeforeQuit = vi.fn(() => unsub);
    const { unmount } = renderHook(() => useAppShutdown());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
