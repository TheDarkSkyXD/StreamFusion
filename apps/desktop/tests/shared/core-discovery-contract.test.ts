import { describe, expect, it } from "vitest";

import {
  hasCompleteDiscoveryCoverage as coreHasCompleteDiscoveryCoverage,
  normalizeSearchQuery as coreNormalizeSearchQuery,
  rankChannelMatch as coreRankChannelMatch,
} from "@streamfusion/core/discovery";
import { rankChannelMatch as desktopRankChannelMatch } from "@/features/discovery/utils/search/channel-search-contract";
import { normalizeSearchQuery as desktopNormalizeSearchQuery } from "@/features/discovery/utils/search/search-normalization";
import {
  hasCompleteDiscoveryCoverage as desktopHasCompleteDiscoveryCoverage,
  type DiscoveryProviderCompletion,
} from "@shared/discovery-types";

// Guards: Desktop search normalization, matching, and provider-completion policy remain bound to Core during extraction.
describe("shared Core discovery compatibility", () => {
  it("routes Desktop search rules through the Core implementation", () => {
    expect(desktopNormalizeSearchQuery).toBe(coreNormalizeSearchQuery);
    expect(desktopRankChannelMatch).toBe(coreRankChannelMatch);
    expect(desktopNormalizeSearchQuery(" Café_creator ")).toBe("cafe creator");
    expect(
      desktopRankChannelMatch(
        { username: "cafe_creator", displayName: "Café Creator" },
        "cafe creator"
      )
    ).toEqual({ tier: 0, editDistance: 0 });
  });

  it("keeps complete coverage strict across both Platforms", () => {
    const completion: DiscoveryProviderCompletion = {
      twitch: "complete",
      kick: "partial",
    };

    expect(desktopHasCompleteDiscoveryCoverage).toBe(coreHasCompleteDiscoveryCoverage);
    expect(desktopHasCompleteDiscoveryCoverage(completion)).toBe(false);
    expect(desktopHasCompleteDiscoveryCoverage(completion, "twitch")).toBe(true);
  });
});
