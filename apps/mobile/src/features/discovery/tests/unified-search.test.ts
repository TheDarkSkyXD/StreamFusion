import { describe, expect, it } from "vitest";

import { emptySearchHistory } from "../domain/search-history";
import { composeUnifiedSearch } from "../domain/unified-search";
import {
  fixtureSearchIntent,
  fixtureSearchOutcome,
} from "../domain/search-fixture";

describe("composeUnifiedSearch", () => {
  it("caps All-tab videos and clips and keeps a best-match channel", () => {
    const view = composeUnifiedSearch({
      history: emptySearchHistory(),
      intent: fixtureSearchIntent("arcade"),
      kick: fixtureSearchOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureSearchOutcome("twitch", "ready"),
    });
    expect(view.phase).toBe("ready");
    expect(view.bestMatch?.id).toBe("twitch-channel");
    expect(view.collection.videos).toHaveLength(2);
    expect(view.collection.clips).toHaveLength(2);
    expect(view.collection.streams.every((stream) => stream.isLive)).toBe(true);
  });

  it("scopes typed tabs and hides media when live-only is on", () => {
    const videos = composeUnifiedSearch({
      history: emptySearchHistory(),
      intent: { ...fixtureSearchIntent(), resultType: "videos" },
      kick: fixtureSearchOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureSearchOutcome("twitch", "ready"),
    });
    expect(videos.collection.channels).toEqual([]);
    expect(videos.collection.videos.length).toBeGreaterThan(0);

    const liveOnly = composeUnifiedSearch({
      history: emptySearchHistory(),
      intent: { ...fixtureSearchIntent(), liveOnly: true },
      kick: fixtureSearchOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureSearchOutcome("twitch", "ready"),
    });
    expect(liveOnly.collection.videos).toEqual([]);
    expect(liveOnly.collection.clips).toEqual([]);
  });

  it("stays loading until a requested catalog arrives", () => {
    const view = composeUnifiedSearch({
      history: emptySearchHistory(),
      intent: fixtureSearchIntent(),
      loading: true,
    });
    expect(view.phase).toBe("loading");
  });

  it("keeps Kick when Twitch fails and lists only the failed platform for retry", () => {
    const view = composeUnifiedSearch({
      history: emptySearchHistory(),
      intent: fixtureSearchIntent(),
      kick: fixtureSearchOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureSearchOutcome("twitch", "twitch-fail"),
    });
    expect(view.phase).toBe("partial");
    expect(view.retryablePlatforms).toEqual(["twitch"]);
    expect(view.collection.channels.some((channel) => channel.platform === "kick")).toBe(
      true,
    );
  });
});
