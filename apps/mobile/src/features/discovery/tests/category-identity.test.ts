import { describe, expect, it } from "vitest";

import {
  categoryIdForPlatform,
  defaultCategoryRequest,
  identityFromCategory,
  platformsForScope,
} from "../domain/category-identity";
import { parseLanguageFilter } from "../domain/broadcast-languages";

describe("category identity", () => {
  it("seeds detail from a merged catalog row", () => {
    const identity = identityFromCategory({
      boxArtUrl: "https://example.com/box.png",
      id: "15",
      name: "Just Chatting",
      otherId: "509658",
      platform: "kick",
      viewerCount: 12,
    });
    const request = defaultCategoryRequest(identity, "en", "week");
    expect(request.tab).toBe("live");
    expect(request.videoSort).toBe("recent");
    expect(request.clipSort).toBe("views");
    expect(request.language).toBe("en");
    expect(platformsForScope("all", identity)).toEqual(["twitch", "kick"]);
    expect(categoryIdForPlatform(identity, "twitch")).toBe("509658");
    expect(categoryIdForPlatform(identity, "kick")).toBe("15");
  });

  it("falls unknown language preferences back to all", () => {
    expect(parseLanguageFilter(null)).toBe("all");
    expect(parseLanguageFilter("xx")).toBe("all");
    expect(parseLanguageFilter("ja")).toBe("ja");
  });
});
