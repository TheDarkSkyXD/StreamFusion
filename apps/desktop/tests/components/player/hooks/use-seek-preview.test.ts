import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockHlsInstance = {
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  currentLevel: -1,
};

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      ERROR: "hlsError",
    };
    loadSource = mockHlsInstance.loadSource;
    attachMedia = mockHlsInstance.attachMedia;
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

describe("useSeekPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("initializes HLS when streamUrl is an m3u8", () => {
    renderHook(() => useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" }));

    expect(mockHlsInstance.loadSource).toHaveBeenCalledWith("https://test.com/stream.m3u8");
    expect(mockHlsInstance.attachMedia).toHaveBeenCalled();
  });

  it("destroys HLS instance on unmount", () => {
    const { unmount } = renderHook(() =>
      useSeekPreview({ streamUrl: "https://test.com/stream.m3u8" })
    );

    unmount();

    expect(mockHlsInstance.destroy).toHaveBeenCalled();
  });

  it("destroys previous HLS when streamUrl changes", () => {
    const { rerender } = renderHook(({ url }) => useSeekPreview({ streamUrl: url }), {
      initialProps: { url: "https://test.com/a.m3u8" },
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
