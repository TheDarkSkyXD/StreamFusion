import { describe, expect, it } from "vitest";

import {
  qualityLevelToPreference,
  resolvePreferredQualityId,
} from "@/features/playback/components/player/quality-preference";
import type { QualityLevel } from "@/features/playback/components/player/types";

function level(overrides: Partial<QualityLevel>): QualityLevel {
  return {
    id: "0",
    label: "720p60",
    width: 1280,
    height: 720,
    bitrate: 3_000_000,
    ...overrides,
  };
}

// Guards: manual quality choices persist semantically across reordered manifests instead of retaining an HLS index.
// Guards: Highest ranks real named renditions even when a provider omits numeric height metadata, without treating a display-only Source label as explicit Source metadata.
describe("quality preference", () => {
  it("converts explicit Source, fixed rendition, and Auto choices to semantic intent", () => {
    expect(qualityLevelToPreference(level({ isSource: true }))).toBe("highest");
    expect(qualityLevelToPreference(level({ height: 720 }))).toBe("720p");
    expect(qualityLevelToPreference(level({ id: "auto", label: "Auto", isAuto: true }))).toBe(
      "auto"
    );
  });

  it("selects a named 1080p rendition over a lower measured rendition for Highest", () => {
    const levels = [
      level({ id: "kick-720", label: "720p60", height: 720, bitrate: 3_000_000 }),
      level({
        id: "kick-1080",
        label: "1080p60",
        name: "1080p60",
        height: 0,
        bitrate: 6_000_000,
      }),
    ];

    expect(resolvePreferredQualityId(levels, "highest")).toBe("kick-1080");
  });
});
