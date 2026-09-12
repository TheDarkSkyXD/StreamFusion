import { describe, expect, it } from "vitest";

import { composeCategoryCatalog, mergeCategories } from "../domain/category-catalog";
import {
  fixtureCategory,
  fixtureOutcome,
} from "../domain/discovery-fixture";

describe("mergeCategories", () => {
  it("merges equivalent names, sums viewers, and lets Kick win Slots", () => {
    const merged = mergeCategories([
      fixtureCategory("twitch", "slots-twitch", "Slots & Casino", 40),
      fixtureCategory("kick", "slots-kick", "Slots", 80),
      fixtureCategory("twitch", "jc", "Just Chatting", 20),
    ]);
    expect(merged[0]).toMatchObject({
      id: "slots-kick",
      name: "Slots",
      otherId: "slots-twitch",
      platform: "kick",
      viewerCount: 120,
    });
    expect(merged.map((category) => category.id)).toEqual([
      "slots-kick",
      "jc",
    ]);
  });
});

describe("composeCategoryCatalog", () => {
  it("filters locally and stays ready when one provider is complete", () => {
    const view = composeCategoryCatalog({
      kick: {
        ...fixtureOutcome("kick", "ready"),
        items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
      },
      language: "en",
      loading: false,
      query: "just",
      twitch: {
        ...fixtureOutcome("twitch", "ready"),
        items: [fixtureCategory("twitch", "509658", "Just Chatting", 30)],
      },
    });
    expect(view.phase).toBe("ready");
    expect(view.categories).toHaveLength(1);
    expect(view.categories[0]).toMatchObject({
      otherId: "15",
      platform: "twitch",
      viewerCount: 40,
    });
  });

  it("keeps a failed phase when both catalogs fail without cache", () => {
    const view = composeCategoryCatalog({
      kick: {
        ...fixtureOutcome("kick", "kick-fail"),
        items: [],
      },
      language: "all",
      loading: false,
      query: "",
      twitch: {
        ...fixtureOutcome("twitch", "twitch-fail"),
        items: [],
      },
    });
    expect(view.phase).toBe("failed");
    expect(view.retryablePlatforms).toEqual(["twitch", "kick"]);
  });
});
