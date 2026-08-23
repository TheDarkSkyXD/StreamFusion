import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAppShutdownTasks = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/app-shutdown-registry", () => ({ runAppShutdownTasks }));

import { useAppShutdown } from "@/hooks/use-app-shutdown";
import { useChatStore } from "@/store/chat-store";

let onBeforeQuitCallback: (() => void) | null = null;

beforeEach(() => {
  onBeforeQuitCallback = null;
  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    closeWindow: vi.fn(),
    onBeforeQuit: vi.fn((cb: () => void) => {
      onBeforeQuitCallback = cb;
      return vi.fn();
    }),
  };
  runAppShutdownTasks.mockReset();
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

// Guards: the eager app root runs only cleanup registered by features that were actually loaded.
// Guards: renderer shutdown still clears batched chat work without a static chat-store import.
describe("useAppShutdown", () => {
  it("does nothing when the Electron bridge is unavailable", () => {
    // @ts-expect-error -- test-only missing bridge
    delete window.electronAPI;

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

  it("loads the chat store only when shutdown begins and clears batching", async () => {
    const cleanupSpy = vi.spyOn(useChatStore.getState(), "cleanupBatching");
    renderHook(() => useAppShutdown());
    onBeforeQuitCallback!();
    await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledTimes(1));
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

  it("returns the cleanup function from onBeforeQuit", () => {
    const unsub = vi.fn();
    window.electronAPI!.onBeforeQuit = vi.fn(() => unsub);
    const { unmount } = renderHook(() => useAppShutdown());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
