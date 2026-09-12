import { describe, expect, it } from "vitest";

import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";
import { fixtureOutcome } from "../domain/discovery-fixture";

describe("composeHomeLiveDiscovery", () => {
  it("merges ready platform catalogs by viewer count", () => {
    const view = composeHomeLiveDiscovery({
      kick: fixtureOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureOutcome("twitch", "ready"),
    });
    expect(view.phase).toBe("ready");
    expect(view.streams.map((stream) => stream.platform)).toEqual([
      "twitch",
      "kick",
    ]);
  });

  it("keeps a stale cache phase when both platforms are offline-cached", () => {
    const view = composeHomeLiveDiscovery({
      kick: fixtureOutcome("kick", "stale-cache"),
      loading: false,
      twitch: fixtureOutcome("twitch", "stale-cache"),
    });
    expect(view.phase).toBe("offline-cache");
    expect(view.streams).toHaveLength(2);
  });

  it("scopes retry to the failed platform only", () => {
    const view = composeHomeLiveDiscovery({
      kick: fixtureOutcome("kick", "ready"),
      loading: false,
      twitch: fixtureOutcome("twitch", "twitch-fail"),
    });
    expect(view.retryablePlatforms).toEqual(["twitch"]);
    expect(view.streams.map((stream) => stream.platform)).toEqual(["kick"]);
  });

  it("treats cancelled reads as failed without a retry control", () => {
    const view = composeHomeLiveDiscovery({
      kick: fixtureOutcome("kick", "cancelled"),
      loading: false,
      twitch: fixtureOutcome("twitch", "cancelled"),
    });
    expect(view.phase).toBe("failed");
    expect(view.retryablePlatforms).toEqual([]);
  });
});
