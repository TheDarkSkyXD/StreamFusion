import { describe, expect, it } from "vitest";

import {
  formatLiveUptime,
  formatWatchViewerCount,
  formatWatchViewerLine,
} from "../domain/watch-live-meta";

describe("watch live meta formatting", () => {
  it("formats viewer counts with locale grouping", () => {
    expect(formatWatchViewerCount(50_443, "en")).toBe("50,443");
    expect(formatWatchViewerCount(42, "en")).toBe("42");
    expect(formatWatchViewerCount(0, "en")).toBe("0");
    expect(formatWatchViewerCount(undefined, "en")).toBe("0");
    expect(formatWatchViewerCount(null, "en")).toBe("0");
  });

  it("formats live uptime as H:MM:SS when startedAt is set", () => {
    const startedAt = "2026-09-23T12:00:00.000Z";
    const nowMs = Date.parse("2026-09-23T14:15:33.000Z");
    expect(formatLiveUptime(startedAt, nowMs)).toBe("2:15:33");
  });

  it("returns null uptime when startedAt is missing", () => {
    expect(formatLiveUptime(null)).toBeNull();
    expect(formatLiveUptime(undefined)).toBeNull();
    expect(formatLiveUptime("not-a-date")).toBeNull();
  });

  it("builds the top subline with viewers and optional uptime", () => {
    const startedAt = "2026-09-23T12:00:00.000Z";
    const nowMs = Date.parse("2026-09-23T12:05:09.000Z");
    expect(formatWatchViewerLine(50_443, startedAt, nowMs, "en")).toBe(
      "50,443 · 0:05:09",
    );
    expect(formatWatchViewerLine(50_443, null, nowMs, "en")).toBe("50,443");
  });
});
