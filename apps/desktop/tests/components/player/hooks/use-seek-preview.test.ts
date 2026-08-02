import { act, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockHlsInstance = {
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  detachMedia: vi.fn(),
  startLoad: vi.fn(),
  stopLoad: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  currentLevel: -1,
};
const mockHlsConstructor = vi.fn();
const mockTimeoutStart = vi.fn();

vi.mock("hls.js", () => {
  class FakeHls {
    constructor() {
      mockHlsConstructor();
    }
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      ERROR: "hlsError",
    };
    loadSource = mockHlsInstance.loadSource;
    attachMedia = mockHlsInstance.attachMedia;
    detachMedia = mockHlsInstance.detachMedia;
    startLoad = mockHlsInstance.startLoad;
    stopLoad = mockHlsInstance.stopLoad;
    on = mockHlsInstance.on;
    off = mockHlsInstance.off;
    destroy = mockHlsInstance.destroy;
    currentLevel = -1;
  }
  return { default: FakeHls };
});

vi.mock("@/hooks/useManagedTimeout", () => ({
  useManagedTimeout: (cb: () => void) => {
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
    return {
      start: (ms: number) => {
        mockTimeoutStart(ms);
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(cb, ms);
      },
      clear: () => {
        if (pendingTimeout) clearTimeout(pendingTimeout);
      },
    };
  },
}));

vi.mock("@/components/player/kick/kick-clip-loader", () => ({
  isKickClipPlaylistUrl: vi.fn(() => false),
  createKickClipPlaylistLoader: vi.fn(),
}));

import { useSeekPreview } from "@/components/player/hooks/use-seek-preview";

// Guards: opening a VOD may prefetch its small manifest but must not attach or decode hidden video
// Guards: hover starts at the requested second without first downloading the beginning of the VOD
// Guards: leaving the timeline must detach and stop the hidden decoder without discarding warm metadata
// Guards: leaving a VOD must release the hidden preview video's native media resources
// Guards: timeline preview extraction must be scheduled within the 20ms interaction budget
// Guards: preview decoding targets one stable frame per whole second instead of fractional churn
// Guards: revisiting a captured second must paint its cached frame immediately without another seek
// Guards: an uncached second never displays the unrelated poster while its real frame is decoding
describe("useSeekPreview", () => {
  let pauseSpy: ReturnType<typeof vi.spyOn>;
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    pauseSpy.mockRestore();
    loadSpy.mockRestore();
  });

  it("returns thumbnail as initial preview image", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: null, thumbnail: "thumb.jpg" })
    );

    expect(result.current.previewImage).toBe("thumb.jpg");
  });

  it("returns undefined previewImage when no thumbnail or streamUrl", () => {
    const { result } = renderHook(() => useSeekPreview({ streamUrl: null }));

    expect(result.current.previewImage).toBeUndefined();
  });

  it("handleSeekHover with null clears preview", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.m3u8", thumbnail: "thumb.jpg" })
    );

    act(() => {
      result.current.handleSeekHover(null);
    });

    expect(result.current.previewImage).toBeUndefined();
  });

  it("prewarms only the HLS manifest until the timeline is hovered", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    expect(mockHlsConstructor).toHaveBeenCalledOnce();
    expect(mockHlsInstance.loadSource).toHaveBeenCalledWith("https://test.com/stream.m3u8");
    expect(mockHlsInstance.attachMedia).not.toHaveBeenCalled();
    expect(mockHlsInstance.startLoad).not.toHaveBeenCalled();

    act(() => {
      result.current.handleSeekHover(30);
      vi.advanceTimersByTime(20);
    });

    expect(mockHlsInstance.attachMedia).toHaveBeenCalled();
    expect(mockHlsInstance.startLoad).toHaveBeenCalledWith(30);
  });

  it("schedules preview extraction within 20ms", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    act(() => {
      result.current.handleSeekHover(30);
    });

    expect(mockTimeoutStart.mock.lastCall?.[0]).toBeLessThanOrEqual(20);
  });

  it("keeps an uncached preview image empty until its real frame is decoded", () => {
    const { result } = renderHook(() =>
      useSeekPreview({
        streamUrl: "https://test.com/stream.m3u8",
        thumbnail: "unrelated-poster.jpg",
      })
    );

    act(() => {
      result.current.handleSeekHover(30);
    });

    expect(result.current.previewImage).toBeUndefined();
  });

  it("decodes the nearest whole-second preview frame", () => {
    const currentTimeSetter = vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set");
    try {
      const { result } = renderHook(() =>
        useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
      );

      act(() => {
        result.current.handleSeekHover(30.6);
        vi.advanceTimersByTime(40);
      });

      expect(currentTimeSetter).toHaveBeenLastCalledWith(31);
    } finally {
      currentTimeSetter.mockRestore();
    }
  });

  it("reuses a captured whole-second frame immediately", () => {
    const originalCreateElement = document.createElement.bind(document);
    let previewVideo: HTMLVideoElement | null = null;
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "video") previewVideo = element as HTMLVideoElement;
      return element;
    }) as typeof document.createElement);
    const drawImage = vi.fn();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,cached-second");

    try {
      const { result } = renderHook(() =>
        useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
      );

      act(() => {
        result.current.handleSeekHover(10);
        vi.advanceTimersByTime(40);
        previewVideo?.dispatchEvent(new Event("seeked"));
      });
      expect(result.current.previewImage).toBe("data:image/jpeg;base64,cached-second");

      act(() => result.current.handleSeekHover(null));
      mockTimeoutStart.mockClear();
      act(() => result.current.handleSeekHover(10));

      expect(result.current.previewImage).toBe("data:image/jpeg;base64,cached-second");
      expect(mockTimeoutStart).not.toHaveBeenCalled();
    } finally {
      createElementSpy.mockRestore();
      getContextSpy.mockRestore();
      toDataUrlSpy.mockRestore();
    }
  });

  it("stops hidden decoding but keeps the manifest warm when timeline hover ends", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    act(() => {
      result.current.handleSeekHover(30);
    });
    mockHlsInstance.destroy.mockClear();

    act(() => {
      result.current.handleSeekHover(null);
    });

    expect(mockHlsInstance.stopLoad).toHaveBeenCalled();
    expect(mockHlsInstance.detachMedia).toHaveBeenCalled();
    expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });

  it("destroys HLS instance on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    act(() => {
      result.current.handleSeekHover(30);
    });
    unmount();

    expect(mockHlsInstance.destroy).toHaveBeenCalled();
  });

  it("releases the hidden media element on unmount", () => {
    const removeAttributeSpy = vi.spyOn(Element.prototype, "removeAttribute");
    const { result, unmount } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    act(() => {
      result.current.handleSeekHover(30);
    });
    unmount();

    expect(pauseSpy).toHaveBeenCalled();
    expect(removeAttributeSpy).toHaveBeenCalledWith("src");
    expect(loadSpy).toHaveBeenCalled();

    removeAttributeSpy.mockRestore();
  });

  it("destroys previous HLS when streamUrl changes", () => {
    const { result, rerender } = renderHook(({ url }) => useSeekPreview({ streamUrl: url }), {
      initialProps: { url: "https://test.com/a.m3u8" },
    });

    act(() => {
      result.current.handleSeekHover(30);
    });

    mockHlsInstance.destroy.mockClear();

    rerender({ url: "https://test.com/b.m3u8" });

    expect(mockHlsInstance.destroy).toHaveBeenCalled();
  });

  it("handleSeekHover provides a function that accepts time", () => {
    const { result } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    expect(typeof result.current.handleSeekHover).toBe("function");

    expect(() => {
      act(() => {
        result.current.handleSeekHover(30);
      });
    }).not.toThrow();
  });
});
