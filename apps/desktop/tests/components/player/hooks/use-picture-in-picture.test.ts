import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { usePictureInPicture } from "@/components/player/hooks/use-picture-in-picture";

function createMockVideo(): HTMLVideoElement & { _emit: (e: string) => void } {
  const listeners: Record<string, Function[]> = {};
  const video = {
    requestPictureInPicture: vi.fn(() => Promise.resolve({})),
    addEventListener: vi.fn((event: string, fn: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn((event: string, fn: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    }),
    _emit: (event: string) => {
      (listeners[event] ?? []).forEach((fn) => fn());
    },
  } as unknown as HTMLVideoElement & { _emit: (e: string) => void };
  return video;
}

describe("usePictureInPicture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "pictureInPictureElement", {
      value: null,
      writable: true,
      configurable: true,
    });
    document.exitPictureInPicture = vi.fn(() => Promise.resolve());
  });

  it("returns isPip false initially", () => {
    const video = createMockVideo();
    const { result } = renderHook(() => usePictureInPicture({ current: video }));
    expect(result.current.isPip).toBe(false);
  });

  it("sets isPip to true when enterpictureinpicture fires", () => {
    const video = createMockVideo();
    const { result } = renderHook(() => usePictureInPicture({ current: video }));

    act(() => {
      video._emit("enterpictureinpicture");
    });

    expect(result.current.isPip).toBe(true);
  });

  it("sets isPip to false when leavepictureinpicture fires", () => {
    const video = createMockVideo();
    const { result } = renderHook(() => usePictureInPicture({ current: video }));

    act(() => {
      video._emit("enterpictureinpicture");
    });
    expect(result.current.isPip).toBe(true);

    act(() => {
      video._emit("leavepictureinpicture");
    });
    expect(result.current.isPip).toBe(false);
  });

  it("togglePip enters pip when not in pip mode", async () => {
    const video = createMockVideo();
    const { result } = renderHook(() => usePictureInPicture({ current: video }));

    await act(async () => {
      await result.current.togglePip();
    });

    expect(video.requestPictureInPicture).toHaveBeenCalled();
  });

  it("togglePip exits pip when already in pip mode", async () => {
    const video = createMockVideo();
    Object.defineProperty(document, "pictureInPictureElement", {
      value: video,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => usePictureInPicture({ current: video }));

    await act(async () => {
      await result.current.togglePip();
    });

    expect(document.exitPictureInPicture).toHaveBeenCalled();
  });

  it("handles null videoRef without crashing", async () => {
    const { result } = renderHook(() => usePictureInPicture({ current: null }));

    await act(async () => {
      await result.current.togglePip();
    });

    expect(result.current.isPip).toBe(false);
  });

  it("handles requestPictureInPicture rejection without crashing", async () => {
    const video = createMockVideo();
    video.requestPictureInPicture = vi.fn(async (): Promise<PictureInPictureWindow> => {
      throw new Error("PiP not allowed");
    });

    const { result } = renderHook(() => usePictureInPicture({ current: video }));

    await act(async () => {
      await result.current.togglePip();
    });

    // Should not throw
    expect(result.current.isPip).toBe(false);
  });

  it("cleans up event listeners on unmount", () => {
    const video = createMockVideo();
    const { unmount } = renderHook(() => usePictureInPicture({ current: video }));

    unmount();

    expect(video.removeEventListener).toHaveBeenCalledWith(
      "enterpictureinpicture",
      expect.any(Function)
    );
    expect(video.removeEventListener).toHaveBeenCalledWith(
      "leavepictureinpicture",
      expect.any(Function)
    );
  });
});
