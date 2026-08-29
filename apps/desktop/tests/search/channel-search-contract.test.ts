import { describe, expect, it } from "vitest";

import type { UnifiedChannel } from "@shared/platform-types";
import {
  isExactChannelSearchMatch,
  rankSearchChannels,
} from "@/features/discovery/utils/search/channel-search-contract";

function channel(
  id: string,
  username: string,
  followerCount?: number,
  overrides: Partial<UnifiedChannel> = {}
): UnifiedChannel {
  return {
    id,
    platform: "twitch",
    username,
    displayName: username,
    avatarUrl: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
    followerCount,
    ...overrides,
  };
}

// Guards: exact normalized Channel identity outranks a more popular weaker identity match.
describe("rankSearchChannels", () => {
  it("ranks an exact small creator above a popular prefix match", () => {
    const exact = channel("exact", "creator", 0);
    const popularPrefix = channel("prefix", "creator_live", 1_000_000);

    expect(rankSearchChannels([popularPrefix, exact], "creator").map((result) => result.id)).toEqual([
      "exact",
      "prefix",
    ]);
  });

  it("ranks a compact identity as exact for space, underscore, and hyphen queries", () => {
    const exact = channel("exact", "iceposeidon", 0, { displayName: "IcePoseidon" });
    const popularPrefix = channel("prefix", "iceposeidonlive", 1_000_000);

    for (const query of ["ice poseidon", "ice_poseidon", "ice-poseidon", "iceposeidon"]) {
      expect(rankSearchChannels([popularPrefix, exact], query).map((result) => result.id)).toEqual([
        "exact",
        "prefix",
      ]);
      expect(isExactChannelSearchMatch(exact, query)).toBe(true);
    }
  });

  it("ranks prefix, substring, and fuzzy identity matches by strength", () => {
    const prefix = channel("prefix", "creator_world", 1);
    const substring = channel("substring", "the_creator", 1_000_000);
    const fuzzy = channel("fuzzy", "cretaor", 2_000_000);

    expect(
      rankSearchChannels([fuzzy, substring, prefix], "creator").map((result) => result.id)
    ).toEqual(["prefix", "substring", "fuzzy"]);
  });

  it("ranks a compact prefix above a more popular token match", () => {
    const compactPrefix = channel("prefix", "iceposeidonlive", 0);
    const tokenMatch = channel("token", "the_ice_poseidon", 1_000_000);

    expect(
      rankSearchChannels([tokenMatch, compactPrefix], "ice poseidon").map((result) => result.id)
    ).toEqual(["prefix", "token"]);
  });

  it("does not broaden compact identity matching into unrelated fuzzy results", () => {
    const unrelated = channel("unrelated", "ice_positional", 1_000_000);

    expect(rankSearchChannels([unrelated], "ice poseidon")).toEqual([]);
  });

  it("preserves authoritative identity formatting while comparing compact forms", () => {
    const formatted = channel("formatted", "Ice_Poseidon", 0, {
      displayName: "Ice-Poseidon",
    });

    const [result] = rankSearchChannels([formatted], "iceposeidon");

    expect(result).toBe(formatted);
    expect(result).toEqual(
      expect.objectContaining({ username: "Ice_Poseidon", displayName: "Ice-Poseidon" })
    );
  });

  it("uses higher trustworthy follower count within the same relevance score", () => {
    const smaller = channel("smaller", "the_creator_one", 10);
    const popular = channel("popular", "the_creator_two", 50_000);

    expect(rankSearchChannels([smaller, popular], "creator").map((result) => result.id)).toEqual([
      "popular",
      "smaller",
    ]);
  });

  it("distinguishes a real zero follower count from missing follower data", () => {
    const missing = channel("missing", "the_creator_missing");
    const realZero = channel("zero", "the_creator_zero", 0);

    expect(rankSearchChannels([missing, realZero], "creator").map((result) => result.id)).toEqual([
      "zero",
      "missing",
    ]);
  });

  it("uses normalized display name, username, platform, and id as stable tie-breakers", () => {
    const values = [
      channel("2", "creator_same", undefined, {
        platform: "twitch",
        displayName: "Creator Same",
      }),
      channel("1", "creator_same", undefined, {
        platform: "kick",
        displayName: "Creator Same",
      }),
      channel("bravo", "creator_bravo", undefined, {
        platform: "twitch",
        displayName: "Creator Bravo",
      }),
      channel("2", "creator_same", undefined, {
        platform: "kick",
        displayName: "Creator Same",
      }),
      channel("alpha", "creator_alpha", undefined, {
        platform: "twitch",
        displayName: "Creator Alpha",
      }),
    ];

    expect(
      rankSearchChannels(values, "creator").map(
        (result) => `${result.displayName}:${result.username}:${result.platform}:${result.id}`
      )
    ).toEqual([
      "Creator Alpha:creator_alpha:twitch:alpha",
      "Creator Bravo:creator_bravo:twitch:bravo",
      "Creator Same:creator_same:kick:1",
      "Creator Same:creator_same:kick:2",
      "Creator Same:creator_same:twitch:2",
    ]);
  });

  it("normalizes case, spacing, accents, and separators for exact identity matches", () => {
    const exact = channel("exact", "other", 0, { displayName: "Créator Name" });
    const prefix = channel("prefix", "creator_name_live", 1_000_000);

    expect(
      rankSearchChannels([prefix, exact], "  @CREATOR__name  ").map((result) => result.id)
    ).toEqual(["exact", "prefix"]);
  });

  it("returns a new ranked array without mutating the input", () => {
    const prefix = channel("prefix", "creator_live", 100);
    const exact = channel("exact", "creator", 0);
    const input = [prefix, exact];

    const ranked = rankSearchChannels(input, "creator");

    expect(ranked).not.toBe(input);
    expect(input).toEqual([prefix, exact]);
  });

  it("limits one-character queries to exact and prefix matches", () => {
    const substring = channel("substring", "beta", 1_000_000);
    const prefix = channel("prefix", "alpha", 0);

    expect(rankSearchChannels([substring, prefix], "a").map((result) => result.id)).toEqual([
      "prefix",
    ]);
  });

  it("deduplicates Platform-scoped identity deterministically", () => {
    const sparse = channel("same", "creator");
    const rich = channel("same", "creator", 100, {
      displayName: "Creator",
      avatarUrl: "https://example.com/creator.webp",
    });

    expect(rankSearchChannels([sparse, rich], "creator")).toEqual([rich]);
    expect(rankSearchChannels([rich, sparse], "creator")).toEqual([rich]);
  });
});
