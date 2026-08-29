import { describe, expect, it } from "vitest";

import {
  compactSearchIdentity,
  normalizeSearchQuery,
  normalizeSearchTokens,
} from "@/features/discovery/utils/search/search-normalization";

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

  it("equates compact, space, underscore, and hyphen identity forms without changing source text", () => {
    const identities = ["IcePoseidon", "ice poseidon", "ice_poseidon", "ice-poseidon"];

    expect(identities.map(compactSearchIdentity)).toEqual([
      "iceposeidon",
      "iceposeidon",
      "iceposeidon",
      "iceposeidon",
    ]);
    expect(identities).toEqual([
      "IcePoseidon",
      "ice poseidon",
      "ice_poseidon",
      "ice-poseidon",
    ]);
  });
});
