import { describe, expect, it } from "vitest";

import {
  parsePlatform,
  requirePlatform,
  validateVideoSearch,
} from "@/features/playback/routes/route-boundaries";
import { validateSearchQuery } from "@/features/discovery/routes";

describe("route boundaries", () => {
  // Guards: URL params and search values are untrusted strings at the router boundary.
  it("accepts only supported platform route params", () => {
    expect(parsePlatform("kick")).toBe("kick");
    expect(parsePlatform("twitch")).toBe("twitch");
    expect(parsePlatform("youtube")).toBeNull();
    expect(() => requirePlatform("youtube")).toThrow("Unsupported platform route");
  });

  it("rejects non-string search queries", () => {
    expect(validateSearchQuery({ q: ["injected"] })).toEqual({ q: "" });
    expect(validateSearchQuery({ q: "music" })).toEqual({ q: "music" });
  });

  it("keeps only correctly typed video metadata", () => {
    expect(
      validateVideoSearch({
        title: 42,
        tags: ["gaming", 7],
        isMature: "true",
        channelName: "streamer",
      })
    ).toEqual({
      channelName: "streamer",
      isMature: true,
    });
  });
});
