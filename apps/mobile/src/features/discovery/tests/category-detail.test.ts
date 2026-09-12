import type { SerializedTimestamp } from "@streamfusion/core/content";
import { describe, expect, it } from "vitest";

import { composeCategoryDetail } from "../domain/category-detail";
import {
  defaultCategoryRequest,
  GUEST_CATEGORY_FOLLOW,
} from "../domain/category-identity";
import {
  fixtureClip,
  fixtureOutcome,
  fixtureStream,
  fixtureVideo,
} from "../domain/discovery-fixture";

const chatting = {
  boxArtUrl: "https://example.com/box.png",
  id: "509658",
  name: "Just Chatting",
  otherId: "15",
  platform: "twitch" as const,
};

describe("composeCategoryDetail", () => {
  it("keeps guest Follow explained-unavailable", () => {
    const view = composeCategoryDetail({
      identity: defaultCategoryRequest(chatting, "all", "all"),
      loading: false,
      twitch: fixtureOutcome("twitch", "ready"),
    });
    expect(view.follow).toEqual(GUEST_CATEGORY_FOLLOW);
    expect(view.phase).toBe("ready");
    expect(view.media.kind).toBe("live");
  });

  it("explains Kick clips instead of returning an empty success", () => {
    const view = composeCategoryDetail({
      identity: {
        ...defaultCategoryRequest(chatting, "en", "week"),
        platformScope: "kick",
        tab: "clips",
      },
      kickUnavailable: {
        kind: "unavailable",
        reason: "kick-clips-unsupported",
      },
      loading: false,
    });
    expect(view.media).toEqual({
      kind: "unavailable",
      reason: "kick-clips-unsupported",
    });
    expect(view.phase).toBe("ready");
  });

  it("keeps Videos on recorded Twitch rows and never inherits Live sort", () => {
    const view = composeCategoryDetail({
      identity: {
        ...defaultCategoryRequest(chatting, "all", "all"),
        liveSort: "viewers-asc",
        tab: "videos",
        videoSort: "recent",
      },
      loading: false,
      twitch: {
        cache: { kind: "miss" },
        items: [
          fixtureStream("twitch", "live-leak", 99),
          fixtureVideo(
            "twitch",
            "old",
            9,
            "2026-01-01T00:00:00.000Z" as SerializedTimestamp,
          ),
          fixtureVideo(
            "twitch",
            "new",
            1,
            "2026-09-01T00:00:00.000Z" as SerializedTimestamp,
          ),
        ],
        path: { kind: "relay", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      },
    });
    expect(view.media.kind).toBe("videos");
    if (view.media.kind !== "videos") throw new Error("expected videos");
    expect(view.media.items.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("sorts clips by views only", () => {
    const view = composeCategoryDetail({
      identity: {
        ...defaultCategoryRequest(chatting, "all", "day"),
        tab: "clips",
      },
      loading: false,
      twitch: {
        cache: { kind: "miss" },
        items: [
          fixtureClip("twitch", "low", 2),
          fixtureClip("twitch", "high", 40),
        ],
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      },
    });
    expect(view.media.kind).toBe("clips");
    if (view.media.kind !== "clips") throw new Error("expected clips");
    expect(view.media.items.map((item) => item.id)).toEqual(["high", "low"]);
  });
});
