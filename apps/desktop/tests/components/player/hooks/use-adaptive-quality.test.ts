import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useInterval", () => ({
  useInterval: vi.fn(),
}));

import { useAdaptiveQuality } from "@/features/playback/components/player/hooks/use-adaptive-quality";
import { useInterval } from "@/hooks/useInterval";

const mockUseInterval = vi.mocked(useInterval);

function makeQualities(...heights: number[]) {
  return heights.map((h) => ({
    id: `${h}p`,
    label: `${h}p`,
    width: Math.round(h * (16 / 9)),
    height: h,
    bitrate: h * 1000,
    isAuto: false,
  }));
}

function createMockVideo(bufferAhead = 30): HTMLVideoElement {
  return {
    currentTime: 10,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 10 + bufferAhead,
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement;
}

describe("useAdaptiveQuality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
  });

  it("returns initial state with auto tier when no network API", () => {
    const { result } = renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: createMockVideo() },
      })
    );
    expect(result.current.effectiveType).toBeNull();
    expect(result.current.downlink).toBeNull();
    expect(result.current.wasAutoAdjusted).toBe(false);
  });

  it("detects critical buffer health via interval callback", () => {
    const video = createMockVideo();
    Object.defineProperty(video, "buffered", {
      configurable: true,
      value: { length: 0, start: vi.fn(), end: vi.fn() },
    });
    const { result } = renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: video },
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    if (lastCall && lastCall[1] !== null) {
      act(() => { lastCall[0](); });
    }
    expect(result.current.bufferHealth).toBe("critical");
  });

  it("detects low buffer health when buffer is below threshold", () => {
    const { result } = renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: createMockVideo(3) },
        minBufferThreshold: 5,
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    if (lastCall && lastCall[1] !== null) {
      act(() => { lastCall[0](); });
    }
    expect(result.current.bufferHealth).toBe("low");
  });

  it("does not register interval when disabled", () => {
    renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: createMockVideo(1) },
        enabled: false,
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    expect(lastCall[1]).toBeNull();
  });

  it("does not adjust quality when user selected a specific quality", () => {
    const onQualityChange = vi.fn();
    renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "720p",
        onQualityChange,
        hlsRef: { current: null },
        videoRef: { current: createMockVideo(1) },
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    if (lastCall && lastCall[1] !== null) {
      act(() => { lastCall[0](); });
    }
    expect(onQualityChange).not.toHaveBeenCalled();
  });

  it("resets wasAutoAdjusted when user manually selects quality", () => {
    const { result, rerender } = renderHook(
      ({ qualityId }) =>
        useAdaptiveQuality({
          qualities: makeQualities(1080, 720, 480, 360),
          currentQualityId: qualityId,
          onQualityChange: vi.fn(),
          hlsRef: { current: null },
          videoRef: { current: createMockVideo() },
        }),
      { initialProps: { qualityId: "auto" } }
    );
    rerender({ qualityId: "720p" });
    expect(result.current.wasAutoAdjusted).toBe(false);
  });

  it("handles empty qualities without error", () => {
    const onQualityChange = vi.fn();
    const { result } = renderHook(() =>
      useAdaptiveQuality({
        qualities: [],
        currentQualityId: "auto",
        onQualityChange,
        hlsRef: { current: null },
        videoRef: { current: createMockVideo() },
      })
    );
    expect(result.current.recommendedTier).toBe("auto");
    expect(onQualityChange).not.toHaveBeenCalled();
  });

  it("detects good buffer health correctly", () => {
    const { result } = renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: createMockVideo(30) },
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    if (lastCall && lastCall[1] !== null) {
      act(() => { lastCall[0](); });
    }
    expect(result.current.bufferHealth).toBe("good");
  });

  it("handles null videoRef without crashing", () => {
    expect(() => {
      renderHook(() =>
        useAdaptiveQuality({
          qualities: makeQualities(1080, 720),
          currentQualityId: "auto",
          onQualityChange: vi.fn(),
          hlsRef: { current: null },
          videoRef: { current: null },
        })
      );
    }).not.toThrow();
  });

  it("registers 2-second interval when enabled", () => {
    renderHook(() =>
      useAdaptiveQuality({
        qualities: makeQualities(1080, 720, 480, 360),
        currentQualityId: "auto",
        onQualityChange: vi.fn(),
        hlsRef: { current: null },
        videoRef: { current: createMockVideo() },
        enabled: true,
      })
    );
    const lastCall = mockUseInterval.mock.calls[mockUseInterval.mock.calls.length - 1];
    expect(lastCall[1]).toBe(2000);
  });
});
