import { describe, expect, it } from "vitest";
import type { GuestFollow } from "@streamfusion/core/follows";

import { unionFollowMembership } from "../domain/union-follow-membership";

const guest: GuestFollow = {
  channelId: "g1",
  channelLogin: "guestchan",
  displayName: "Guest",
  followedAt: "2026-09-01T00:00:00.000Z" as GuestFollow["followedAt"],
  platform: "twitch",
};

const account: GuestFollow = {
  channelId: "a1",
  channelLogin: "accountchan",
  displayName: "Account",
  followedAt: "2026-09-02T00:00:00.000Z" as GuestFollow["followedAt"],
  platform: "twitch",
};

const overlapAccount: GuestFollow = {
  ...guest,
  displayName: "AccountOverwrite",
};

describe("unionFollowMembership", () => {
  it("unions guest and account follows with guest winning collisions", () => {
    const merged = unionFollowMembership([guest], [account, overlapAccount]);
    expect(merged).toHaveLength(2);
    expect(merged.find((f) => f.channelId === "g1")?.displayName).toBe("Guest");
    expect(merged.find((f) => f.channelId === "a1")?.channelLogin).toBe(
      "accountchan",
    );
  });
});
