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

const mockGetPosition = vi.fn();
const mockSavePosition = vi.fn();

vi.mock("@/store/playback-position-store", () => ({
  usePlaybackPositionStore: () => ({
    getPosition: mockGetPosition,
    savePosition: mockSavePosition,
  }),
}));

import { useResumePlayback } from "@/components/player/hooks/use-resume-playback";

function createMockVideo(
  opts: { currentTime?: number; duration?: number; readyState?: number; paused?: boolean } = {}
): HTMLVideoElement {
  const listeners: Record<string, Function[]> = {};
  const video = {
    currentTime: opts.currentTime ?? 0,
    duration: opts.duration ?? 3600,
    readyState: opts.readyState ?? 4,
    paused: opts.paused ?? false,
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

describe("useResumePlayback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetPosition.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores saved position when video metadata is ready", () => {
    mockGetPosition.mockReturnValue({ position: 120 });
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    expect(video.currentTime).toBe(120);
  });

  it("does not restore if saved position is near end of video (>95%)", () => {
    mockGetPosition.mockReturnValue({ position: 3500 });
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    expect(video.currentTime).toBe(0);
  });

  it("does not restore if position is 0", () => {
    mockGetPosition.mockReturnValue({ position: 0 });
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    expect(video.currentTime).toBe(0);
  });

  it("does not restore if no saved position exists", () => {
    mockGetPosition.mockReturnValue(null);
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "kick",
        videoId: "vod456",
        videoRef: { current: video } as any,
      })
    );

    expect(video.currentTime).toBe(0);
  });

  it("does not restore if readyState is too low", () => {
    mockGetPosition.mockReturnValue({ position: 120 });
    const video = createMockVideo({ readyState: 0, duration: 0 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    expect(video.currentTime).toBe(0);
  });

  it("does not restore when enabled is false", () => {
    mockGetPosition.mockReturnValue({ position: 120 });
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
        enabled: false,
      })
    );

    expect(video.currentTime).toBe(0);
  });

  it("saves position on pause event", () => {
    const video = createMockVideo({ currentTime: 300, duration: 3600 }) as HTMLVideoElement & {
      _emit: (e: string) => void;
    };

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    act(() => {
      video._emit("pause");
    });

    expect(mockSavePosition).toHaveBeenCalledWith(
      "twitch",
      "vod123",
      300,
      3600,
      undefined,
      undefined
    );
  });

  it("saves position on unmount", () => {
    const video = createMockVideo({ currentTime: 500, duration: 3600 });

    const { unmount } = renderHook(() =>
      useResumePlayback({
        platform: "kick",
        videoId: "clip789",
        videoRef: { current: video } as any,
        title: "Cool Stream",
        thumbnail: "thumb.jpg",
      })
    );

    unmount();

    expect(mockSavePosition).toHaveBeenCalledWith(
      "kick",
      "clip789",
      500,
      3600,
      "Cool Stream",
      "thumb.jpg"
    );
  });

  it("saves position periodically every 30 seconds", () => {
    const video = createMockVideo({ currentTime: 100, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    mockSavePosition.mockClear();

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockSavePosition).toHaveBeenCalled();
  });

  it("does not save periodically when disabled", () => {
    const video = createMockVideo({ currentTime: 100, duration: 3600 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
        enabled: false,
      })
    );

    mockSavePosition.mockClear();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockSavePosition).not.toHaveBeenCalled();
  });

  it("does not save position when currentTime or duration is 0", () => {
    const video = createMockVideo({ currentTime: 0, duration: 0 });

    renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    mockSavePosition.mockClear();

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockSavePosition).not.toHaveBeenCalled();
  });

  it("returns savedPosition and saveCurrentPosition", () => {
    const savedPos = { position: 120 };
    mockGetPosition.mockReturnValue(savedPos);
    const video = createMockVideo({ readyState: 4, duration: 3600 });

    const { result } = renderHook(() =>
      useResumePlayback({
        platform: "twitch",
        videoId: "vod123",
        videoRef: { current: video } as any,
      })
    );

    expect(result.current.savedPosition).toEqual(savedPos);
    expect(typeof result.current.saveCurrentPosition).toBe("function");
  });

  it("handles null videoRef without crashing", () => {
    expect(() => {
      renderHook(() =>
        useResumePlayback({
          platform: "twitch",
          videoId: "vod123",
          videoRef: { current: null } as any,
        })
      );
    }).not.toThrow();
  });
});
