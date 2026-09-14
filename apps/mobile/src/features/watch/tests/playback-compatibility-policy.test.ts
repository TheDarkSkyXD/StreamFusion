import { describe, expect, it } from "vitest";

import { createPlaybackCompatibilityPolicy } from "../adapters/playback-compatibility-policy";

describe("playback compatibility policy", () => {
  it("enables guest playback when no signed policy exists yet", async () => {
    const policy = createPlaybackCompatibilityPolicy({
      read: async () => ({ kind: "disabled", reason: "no-valid-policy" }),
    });
    await expect(policy.read("twitch")).resolves.toEqual({
      kind: "enabled",
      sequence: 0,
    });
  });

  it("disables an omitted identifier in a valid snapshot", async () => {
    const policy = createPlaybackCompatibilityPolicy({
      read: async () => ({ kind: "disabled", reason: "not-allowed" }),
    });
    await expect(policy.read("kick")).resolves.toEqual({
      kind: "disabled",
      reason: "not-allowed",
    });
  });
});
