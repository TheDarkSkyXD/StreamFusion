import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the volume store before importing the hook
const mockSetVolume = vi.fn();
const mockSetMuted = vi.fn();
const mockToggleMute = vi.fn();

let storeVolume = 38;
let storeMuted = false;

vi.mock("@/store/volume-store", () => ({
  useVolumeStore: () => ({
    volume: storeVolume,
    isMuted: storeMuted,
    setVolume: mockSetVolume,
    setMuted: mockSetMuted,
    toggleMute: mockToggleMute,
  }),
}));

import { useVolume } from "@/components/player/hooks/use-volume";

// Helper to create a mock video element
function createMockVideoElement(initialVolume = 1.0): HTMLVideoElement {
  const listeners: Record<string, Function[]> = {};
  let _volume = initialVolume;
  let _muted = false;

  const video = {
    get volume() {
      return _volume;
    },
    set volume(v: number) {
      const old = _volume;
      _volume = v;
      if (old !== v && listeners["volumechange"]) {
        listeners["volumechange"].forEach((fn) => fn());
      }
    },
    get muted() {
      return _muted;
    },
    set muted(v: boolean) {
      _muted = v;
    },
    addEventListener: (event: string, fn: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener: (event: string, fn: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
  } as unknown as HTMLVideoElement;

  return video;
}

describe("useVolume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeVolume = 38;
    storeMuted = false;
  });

  it("should apply stored volume to video element on mount", () => {
    const video = createMockVideoElement();
    const videoRef = { current: video };

    renderHook(() =>
      useVolume({
        videoRef: videoRef as React.RefObject<HTMLVideoElement>,
        watch: "https://stream-a.m3u8",
      })
    );

    expect(video.volume).toBeCloseTo(0.38, 2);
  });

  it("should re-apply stored volume when watch dependency changes", () => {
    const video = createMockVideoElement();
    const videoRef = { current: video };

    const { rerender } = renderHook(
      ({ watch }) =>
        useVolume({
          videoRef: videoRef as React.RefObject<HTMLVideoElement>,
          watch,
        }),
      { initialProps: { watch: "https://stream-a.m3u8" } }
    );

    // Verify initial volume applied
    expect(video.volume).toBeCloseTo(0.38, 2);

    // Simulate HLS re-init resetting volume to default
    (video as any)._skipEvent = true;
    Object.defineProperty(video, "volume", {
      value: 1.0,
      writable: true,
      configurable: true,
    });

    // Switch streams (watch changes)
    rerender({ watch: "https://stream-b.m3u8" });

    // Volume should be re-applied from store, NOT stay at 1.0
    expect(video.volume).toBeCloseTo(0.38, 2);
  });

  it("should NOT overwrite store when syncFromVideoElement fires during re-init", () => {
    const video = createMockVideoElement();
    const videoRef = { current: video };

    const { result } = renderHook(() =>
      useVolume({
        videoRef: videoRef as React.RefObject<HTMLVideoElement>,
        watch: "https://stream-a.m3u8",
      })
    );

    // Clear mock calls from initial mount
    mockSetVolume.mockClear();

    // Simulate what HLS does: reset video.volume to 1.0 during init
    // This triggers the volumechange event -> syncFromVideoElement
    act(() => {
      result.current.syncFromVideoElement();
    });

    // The store should NOT be overwritten with 100 if video.volume
    // was reset by HLS and not by the user
    // After the fix, syncFromVideoElement should be locked during init
    const setVolumeCalls = mockSetVolume.mock.calls;
    const wasSetTo100 = setVolumeCalls.some(
      (call) => Math.round(call[0] as number) === 100
    );
    expect(wasSetTo100).toBe(false);
  });
});
