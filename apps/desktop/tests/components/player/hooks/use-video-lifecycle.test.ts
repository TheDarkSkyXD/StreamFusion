import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Hls from "hls.js";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useVideoLifecycle } from "@/components/player/hooks/use-video-lifecycle";

function createMockVideo(): HTMLVideoElement {
  const parent = document.createElement("div");
  const video = document.createElement("video");
  parent.append(video);
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  vi.spyOn(video, "pause").mockImplementation(() => undefined);
  vi.spyOn(video, "load").mockImplementation(() => undefined);
  vi.spyOn(video, "removeAttribute");
  return video;
}

function createMockHls() {
  const hls = new Hls();
  vi.spyOn(hls, "destroy").mockImplementation(() => undefined);
  vi.spyOn(hls, "loadSource").mockImplementation(() => undefined);
  vi.spyOn(hls, "attachMedia").mockImplementation(() => undefined);
  return hls;
}

describe("useVideoLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Remove performance.memory if it exists so default tests don't use it
    if ("memory" in performance && performance.memory) {
      Object.defineProperty(performance, "memory", { value: undefined, configurable: true });
    }
  });

  it("returns initial state", () => {
    const video = createMockVideo();
    const hls = createMockHls();

    const { result } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
      })
    );

    expect(result.current.isCleaned).toBe(false);
    expect(result.current.isInView).toBe(true);
    expect(typeof result.current.cleanup).toBe("function");
  });

  it("sets preload attribute on video element", () => {
    const video = createMockVideo();
    const hls = createMockHls();

    renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        preloadStrategy: "auto",
      })
    );

    expect(video.preload).toBe("auto");
  });

  it("pauses video when isActive becomes false", () => {
    const video = createMockVideo();
    Object.defineProperty(video, "paused", { value: false, configurable: true, writable: true });
    const hls = createMockHls();

    renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        isActive: false,
      })
    );

    expect(video.pause).toHaveBeenCalled();
  });

  it("does not pause when video is already paused", () => {
    const video = createMockVideo();
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    const hls = createMockHls();

    renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        isActive: false,
      })
    );

    expect(video.pause).not.toHaveBeenCalled();
  });

  it("cleans up video element and HLS on unmount", () => {
    const video = createMockVideo();
    const hls = createMockHls();
    const onCleanup = vi.fn();

    const { unmount } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        onCleanup,
      })
    );

    unmount();

    expect(hls.destroy).toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(video.load).toHaveBeenCalled();
    expect(onCleanup).toHaveBeenCalled();
  });

  it("cleanup function works manually", () => {
    const video = createMockVideo();
    const hls = createMockHls();
    const onCleanup = vi.fn();

    const { result } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        onCleanup,
      })
    );

    act(() => {
      result.current.cleanup();
    });

    expect(hls.destroy).toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(onCleanup).toHaveBeenCalled();
    expect(result.current.isCleaned).toBe(true);
  });

  it("handles null video and hls refs gracefully on cleanup", () => {
    const { unmount } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: null },
        hlsRef: { current: null },
        src: "https://stream.m3u8",
      })
    );

    expect(() => unmount()).not.toThrow();
  });

  it("handles hls.destroy throwing without crashing", () => {
    const video = createMockVideo();
    const hls = createMockHls();
    vi.mocked(hls.destroy).mockImplementation(() => {
      throw new Error("already destroyed");
    });

    const { unmount } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
      })
    );

    expect(() => unmount()).not.toThrow();
  });

  it("starts with isInView=false when lazyLoad is enabled", () => {
    const video = createMockVideo();
    const hls = createMockHls();

    const { result } = renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
        lazyLoad: true,
      })
    );

    expect(result.current.isInView).toBe(false);
  });

  it("uses default preload strategy of metadata", () => {
    const video = createMockVideo();
    const hls = createMockHls();

    renderHook(() =>
      useVideoLifecycle({
        videoRef: { current: video },
        hlsRef: { current: hls },
        src: "https://stream.m3u8",
      })
    );

    expect(video.preload).toBe("metadata");
  });
});
