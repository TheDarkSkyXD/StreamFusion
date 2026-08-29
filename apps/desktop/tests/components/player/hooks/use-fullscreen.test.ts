import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useFullscreen } from "@/features/playback/components/player/hooks/use-fullscreen";

describe("useFullscreen", () => {
  let mockContainer: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer = document.createElement("div");

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      writable: true,
      configurable: true,
    });

    document.exitFullscreen = vi.fn(() => {
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });

    mockContainer.requestFullscreen = vi.fn(() => {
      Object.defineProperty(document, "fullscreenElement", {
        value: mockContainer,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
  });

  it("returns isFullscreen false initially", () => {
    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    expect(result.current.isFullscreen).toBe(false);
  });

  it("updates isFullscreen when fullscreenchange fires", () => {
    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    act(() => {
      Object.defineProperty(document, "fullscreenElement", {
        value: mockContainer,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(result.current.isFullscreen).toBe(true);
  });

  it("toggleFullscreen enters fullscreen when not in fullscreen", async () => {
    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    await act(async () => {
      await result.current.toggleFullscreen();
    });

    expect(mockContainer.requestFullscreen).toHaveBeenCalled();
  });

  it("toggleFullscreen exits fullscreen when already fullscreen", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      value: mockContainer,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    await act(async () => {
      await result.current.toggleFullscreen();
    });

    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it("exits fullscreen if a different element is fullscreen", async () => {
    const otherElement = document.createElement("div");
    Object.defineProperty(document, "fullscreenElement", {
      value: otherElement,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    await act(async () => {
      await result.current.toggleFullscreen();
    });

    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it("handles null containerRef without crashing", async () => {
    const { result } = renderHook(() =>
      useFullscreen({ current: null })
    );

    await act(async () => {
      await result.current.toggleFullscreen();
    });

    expect(result.current.isFullscreen).toBe(false);
  });

  it("handles requestFullscreen throwing an error", async () => {
    mockContainer.requestFullscreen = vi.fn(() => Promise.reject(new Error("denied")));

    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    await act(async () => {
      await result.current.toggleFullscreen();
    });

    // Should not throw
    expect(result.current.isFullscreen).toBe(false);
  });

  it("sets isFullscreen to false when a different element goes fullscreen", () => {
    const { result } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    act(() => {
      const otherElement = document.createElement("div");
      Object.defineProperty(document, "fullscreenElement", {
        value: otherElement,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(result.current.isFullscreen).toBe(false);
  });

  it("cleans up fullscreenchange listener on unmount", () => {
    const spy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useFullscreen({ current: mockContainer })
    );

    unmount();

    expect(spy).toHaveBeenCalledWith("fullscreenchange", expect.any(Function));
    spy.mockRestore();
  });
});
