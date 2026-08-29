import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mockDefaultQuality = "auto";
vi.mock("@/store/auth-store", () => ({
  useAuthStore: <Selected,>(selector: (state: unknown) => Selected): Selected =>
    selector({
      preferences: {
        playback: { defaultQuality: mockDefaultQuality },
      },
    }),
}));

import { useDefaultQuality } from "@/features/playback/components/player/hooks/use-default-quality";
import type { QualityLevel } from "@/features/playback/components/player/types";

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
  makeQuality("1440p60", 1440, { name: "1440p60" }),
  makeQuality("1080p60", 1080, { name: "1080p60" }),
  makeQuality("720p60", 720, { name: "720p60" }),
  makeQuality("480p", 480, { name: "480p" }),
  makeQuality("360p", 360, { name: "360p" }),
  makeQuality("160p", 160, { name: "160p" }),
];

// Guards: Highest dynamically selects the explicit Source rendition regardless of manifest order.
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

  it("selects an explicit Source rendition for the Highest preset", () => {
    mockDefaultQuality = "highest";
    const onQualityChange = vi.fn();
    const twitchQualities = [
      makeQuality("0", 720, { label: "720p60", bitrate: 3_000_000 }),
      makeQuality("1", 1080, {
        label: "1080p60 (Source)",
        bitrate: 6_000_000,
        isSource: true,
      }),
      makeQuality("2", 480, { label: "480p", bitrate: 1_500_000 }),
    ];

    renderHook(() => useDefaultQuality(twitchQualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1");
  });

  it("does not treat a presentation-only Source label as explicit Source metadata", () => {
    mockDefaultQuality = "highest";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("0", 720, { label: "720p60 (Source)", bitrate: 3_000_000 }),
      makeQuality("1", 1080, { label: "1080p60", bitrate: 6_000_000 }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1");
  });

  it("selects the highest real rendition when a Kick manifest has no Source tag", () => {
    mockDefaultQuality = "highest";
    const onQualityChange = vi.fn();
    const kickQualities = [
      makeQuality("0", 720, { label: "720p60", bitrate: 3_000_000 }),
      makeQuality("1", 1080, { label: "1080p30", bitrate: 4_500_000 }),
      makeQuality("2", 480, { label: "480p", bitrate: 1_500_000 }),
      makeQuality("3", 1080, { label: "1080p60", bitrate: 6_000_000 }),
    ];

    renderHook(() => useDefaultQuality(kickQualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("3");
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

  it("keeps a fixed preset as a ceiling and picks its best offered rendition", () => {
    mockDefaultQuality = "1080p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("source", 1440, { label: "1440p60 (Source)", bitrate: 10_000_000 }),
      makeQuality("1080-low", 1080, { label: "1080p30", bitrate: 4_000_000 }),
      makeQuality("720", 720, { label: "720p60", bitrate: 3_000_000 }),
      makeQuality("1080-high", 1080, { label: "1080p60", bitrate: 6_000_000 }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1080-high");
  });

  it("selects exact height match for 1440p", () => {
    mockDefaultQuality = "1440p";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1440p60");
  });

  it("treats 2k as a 1440p quality preference", () => {
    mockDefaultQuality = "2k";
    const onQualityChange = vi.fn();

    renderHook(() => useDefaultQuality(STANDARD_QUALITIES, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1440p60");
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

  it("prefers an exact named fixed rendition with missing height over a lower measured fallback", () => {
    mockDefaultQuality = "1080p";
    const onQualityChange = vi.fn();
    const qualities = [
      makeQuality("720", 720, { name: "720p60", bitrate: 3_000_000 }),
      makeQuality("1080-unknown-height", 0, { name: "1080p60", bitrate: 6_000_000 }),
    ];

    renderHook(() => useDefaultQuality(qualities, "auto", onQualityChange));

    expect(onQualityChange).toHaveBeenCalledWith("1080-unknown-height");
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
