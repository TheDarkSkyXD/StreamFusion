import { describe, expect, it } from "vitest";

import { normalizeSearchQuery, normalizeSearchTokens } from "@/search/search-normalization";

// Guards: renderer cache identities and backend fuzzy matching share one accent- and separator-insensitive canonical query
describe("search normalization", () => {
  it("canonicalizes accents, punctuation, separators, repeated tokens, numbers, and emoji", () => {
    expect(normalizeSearchTokens("  Stréamer_univer--STREAMER 42 🎮  ")).toEqual([
      "streamer",
      "univer",
      "42",
      "🎮",
    ]);
    expect(normalizeSearchQuery("  Stréamer_univer--STREAMER 42 🎮  ")).toBe(
      "streamer univer 42 🎮"
    );
  });
});
