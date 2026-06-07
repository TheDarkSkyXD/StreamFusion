import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mockDefaultQuality = "auto";
vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({
      preferences: {
        playback: { defaultQuality: mockDefaultQuality },
      },
    }),
}));

import { useDefaultQuality } from "@/components/player/hooks/use-default-quality";
import type { QualityLevel } from "@/components/player/types";

function makeQuality(id: string, height: number, opts?: Partial<QualityLevel>): QualityLevel {
  return {
    id,
    label: id,
    width: Math.round(height * (16 / 9)),
    height,
    bitrate: height * 1000,
    isAuto: false,
    ...opts,
  };
}

const STANDARD_QUALITIES: QualityLevel[] = [
  makeQuality("1080p60", 1080, { name: "1080p60" }),
  makeQuality("720p60", 720, { name: "720p60" }),
  makeQuality("480p", 480, { name: "480p" }),
  makeQuality("360p", 360, { name: "360p" }),
  makeQuality("160p", 160, { name: "160p" }),
];

describe("useDefaultQuality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultQuality = "auto";
  });

  it("does nothing when default quality is auto", () => {
    mockDefaultQuality = "auto";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).not.toHaveBeenCalled();
  });

  it("selects exact height match for 720p", () => {
    mockDefaultQuality = "720p";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("720p60");
  });

  it("selects exact height match for 1080p", () => {
    mockDefaultQuality = "1080p";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1080p60");
  });

  it("selects 360p when preference is 360p", () => {
    mockDefaultQuality = "360p";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("360p");
  });

  it("applies default only once (not on re-render)", () => {
    mockDefaultQuality = "720p";
    const onQualityChange = vi.fn();

    const { rerender } = renderHook(
      ({ qualities, currentId }) => useDefaultQuality(qualities, currentId, onQualityChange),
      { initialProps: { qualities: STANDARD_QUALITIES, currentId: "auto" } }
    );

    expect(onQualityChange).toHaveBeenCalledTimes(1);

    rerender({ qualities: STANDARD_QUALITIES, currentId: "720p60" });

    expect(onQualityChange).toHaveBeenCalledTimes(1);
  });

  it("does nothing when qualities array is empty", () => {
    mockDefaultQuality = "720p";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality([], "auto", onQualityChange));

    expect(onQualityChange).not.toHaveBeenCalled();
  });

  it("falls back to closest lower quality when exact match missing", () => {
    mockDefaultQuality = "480p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("1080p", 1080),
      makeQuality("720p", 720),
      makeQuality("360p", 360),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("360p");
  });

  it("selects lowest available when all are higher than target", () => {
    mockDefaultQuality = "160p";
    const onQualityChange = vi.fn();
    const qualities = [makeQuality("1080p", 1080), makeQuality("720p", 720)];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("720p");
  });

  it("skips auto-flagged qualities when matching", () => {
    mockDefaultQuality = "720p";
    const onQualityChange = vi.fn();
    const qualities = [makeQuality("auto", 0, { isAuto: true }), makeQuality("720p", 720)];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("720p");
  });

  it("resets applied flag on unmount/remount", () => {
    mockDefaultQuality = "720p";
    const onQualityChange = vi.fn();

    const { unmount } = renderHook(() =>
      useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange)
    );

    expect(onQualityChange).toHaveBeenCalledTimes(1);
    unmount();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));
    expect(onQualityChange).toHaveBeenCalledTimes(2);
  });

  it("returns defaultQuality from store", () => {
    mockDefaultQuality = "480p";
    const onQualityChange = vi.fn();

    const { result } = renderHook(() =>
      useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange)
    );

    expect(result.current.defaultQuality).toBe("480p");
  });

  it("matches by name/label when height is 0", () => {
    mockDefaultQuality = "1080p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("source", 0, { name: "1080p60 (source)" }),
      makeQuality("medium", 0, { name: "480p30" }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("source");
  });

  it("uses bitrate fallback when all heights are 0 and no name match", () => {
    mockDefaultQuality = "1080p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("high", 0, { bitrate: 5000, name: "High" }),
      makeQuality("low", 0, { bitrate: 1000, name: "Low" }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    // 1080p target (>= 720) picks highest bitrate
    expect(onQualityChange).toHaveBeenCalledWith("high");
  });

  it("uses bitrate fallback low quality for 360p target when heights are 0", () => {
    mockDefaultQuality = "360p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("high", 0, { bitrate: 5000, name: "High" }),
      makeQuality("low", 0, { bitrate: 1000, name: "Low" }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    // 360p target (< 720) picks lowest bitrate
    expect(onQualityChange).toHaveBeenCalledWith("low");
  });
});
