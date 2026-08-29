import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimeAgo } from "@/features/playback/components/related-content/utils";

// Guards: future Kick video timestamps must never render a negative age (regression f4f39e2)
describe("formatTimeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a timestamp five hours in the future as just now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));

    expect(formatTimeAgo("2026-08-02T17:00:00.000Z")).toBe("Just now");
  });

  it("returns an invalid timestamp unchanged instead of rendering NaN seconds ago", () => {
    expect(formatTimeAgo("not-a-kick-timestamp")).toBe("not-a-kick-timestamp");
  });
});
