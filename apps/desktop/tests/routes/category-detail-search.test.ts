import { describe, expect, it } from "vitest";

import { validateCategoryDetailSearch } from "@/features/discovery/routes/category-detail-search";

// Guards: copied Category URLs keep every validated content tab, Live Streams filter, and secondary Platform identity
// Guards: omitted and malformed Category language queries defer to the saved preference, while language= remains explicit All languages
// Guards: missing or genuinely invalid Category tab values still fall back safely to Live Streams
describe("validateCategoryDetailSearch", () => {
  it("preserves a complete deep-linked Live Streams view", () => {
    expect(
      validateCategoryDetailSearch({
        tab: "live",
        platform: "kick",
        language: "es",
        tag: "speedrun",
        sort: "asc",
        otherId: "15",
      })
    ).toEqual({
      tab: "live",
      platform: "kick",
      language: "es",
      tag: "speedrun",
      sort: "asc",
      otherId: "15",
    });
  });

  it.each(["clips", "videos"] as const)("preserves the shipped %s media tab", (tab) => {
    expect(validateCategoryDetailSearch({ tab }).tab).toBe(tab);
  });

  it("preserves an explicit All languages selection", () => {
    expect(validateCategoryDetailSearch({ language: "" }).language).toBe("");
  });

  it("falls back to safe Live defaults for missing and invalid state", () => {
    expect(
      validateCategoryDetailSearch({
        tab: "not-a-category-tab",
        platform: "youtube",
        language: "not-a-language",
        tag: 42,
        sort: "popular",
        otherId: "",
      })
    ).toEqual({
      tab: "live",
      platform: "all",
      language: undefined,
      tag: "",
      sort: "desc",
      otherId: undefined,
    });
    expect(validateCategoryDetailSearch({}).tab).toBe("live");
    expect(validateCategoryDetailSearch({}).language).toBeUndefined();
    expect(validateCategoryDetailSearch({ tab: null }).tab).toBe("live");
    expect(validateCategoryDetailSearch({ otherId: 15 }).otherId).toBe("15");
  });
});
