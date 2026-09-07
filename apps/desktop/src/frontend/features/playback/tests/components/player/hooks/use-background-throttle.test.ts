import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useInterval", () => ({
  useInterval: (cb: () => void, delay: number | null) => {
    const ref = { current: cb };
    ref.current = cb;
    if (delay !== null) {
      const id = setInterval(() => ref.current(), delay);
      return () => clearInterval(id);
    }
  },
}));

import { useBackgroundThrottle } from "@/features/playback/components/player/hooks/use-background-throttle";

function createMockVideo(paused = false, muted = false): HTMLVideoElement {
  let _muted = muted;
  const video = {
    paused,
    get muted() {
      return _muted;
    },
    set muted(v: boolean) {
      _muted = v;
    },
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    play: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement;
  return video;
}

describe("useBackgroundThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial visible/focused state", () => {
    const video = createMockVideo();

    const { result } = renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
      })
    );

    expect(result.current.isVisible).toBe(true);
    expect(result.current.isThrottled).toBe(false);
    expect(result.current.activeAction).toBe("none");
  });

  it("pauses video after grace period when page goes hidden", () => {
    const video = createMockVideo();
    const onThrottleChange = vi.fn();

    renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "pause",
        gracePeriod: 5000,
        onThrottleChange,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(video.pause).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(video.pause).toHaveBeenCalled();
    expect(onThrottleChange).toHaveBeenCalledWith(true, "pause");
  });

  it("mutes video when throttleAction is mute", () => {
    const video = createMockVideo(false, false);
    const onThrottleChange = vi.fn();

    renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "mute",
        gracePeriod: 1000,
        onThrottleChange,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(video.muted).toBe(true);
    expect(onThrottleChange).toHaveBeenCalledWith(true, "mute");
  });

  it("applies throttle after full grace period elapses", () => {
    const video = createMockVideo();

    const { result } = renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "pause",
        gracePeriod: 5000,
        trackWindowFocus: false,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => { vi.advanceTimersByTime(4999); });
    expect(video.pause).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(video.pause).toHaveBeenCalled();
    expect(result.current.isThrottled).toBe(true);
  });

  it("does not throttle when enabled is false", () => {
    const video = createMockVideo();

    renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        enabled: false,
        throttleAction: "pause",
        gracePeriod: 1000,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(video.pause).not.toHaveBeenCalled();
  });

  it("does not throttle when throttleAction is none", () => {
    const video = createMockVideo();

    renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "none",
        gracePeriod: 1000,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(video.pause).not.toHaveBeenCalled();
  });

  it("reduces quality when throttleAction is reduceQuality", () => {
    const video = createMockVideo();
    const onQualityChange = vi.fn();
    const qualities = [
      { id: "1080p", height: 1080 },
      { id: "720p", height: 720 },
      { id: "360p", height: 360 },
    ];

    renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "reduceQuality",
        gracePeriod: 1000,
        onQualityChange,
        currentQualityId: "1080p",
        qualities,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onQualityChange).toHaveBeenCalledWith("360p");
  });

  it("sets isThrottled state after grace period for reduceQuality", () => {
    const video = createMockVideo();
    const onQualityChange = vi.fn();
    const onThrottleChange = vi.fn();
    const qualities = [
      { id: "1080p", height: 1080 },
      { id: "360p", height: 360 },
    ];

    const { result } = renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "reduceQuality",
        gracePeriod: 1000,
        onQualityChange,
        onThrottleChange,
        currentQualityId: "1080p",
        qualities,
        trackWindowFocus: false,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(onQualityChange).toHaveBeenCalledWith("360p");
    expect(result.current.isThrottled).toBe(true);
    expect(result.current.activeAction).toBe("reduceQuality");
    expect(onThrottleChange).toHaveBeenCalledWith(true, "reduceQuality");
  });

  it("handles window blur/focus when trackWindowFocus is true", () => {
    const video = createMockVideo();

    const { result } = renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        trackWindowFocus: true,
        throttleAction: "pause",
        gracePeriod: 1000,
      })
    );

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(video.pause).toHaveBeenCalled();
  });

  it("handles null videoRef without crashing", () => {
    expect(() => {
      renderHook(() =>
        useBackgroundThrottle({
          videoRef: { current: null },
          throttleAction: "pause",
          gracePeriod: 1000,
        })
      );
    }).not.toThrow();
  });

  it("clears throttle timeout on unmount", () => {
    const video = createMockVideo();

    const { unmount } = renderHook(() =>
      useBackgroundThrottle({
        videoRef: { current: video },
        throttleAction: "pause",
        gracePeriod: 5000,
      })
    );

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(video.pause).not.toHaveBeenCalled();
  });
});
