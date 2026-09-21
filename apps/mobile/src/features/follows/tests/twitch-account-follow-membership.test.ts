import { describe, expect, it } from "vitest";

import {
  createTwitchAccountFollowMembership,
  helixFollowedChannelsToGuestFollows,
} from "../adapters/twitch-account-follow-membership";

describe("twitch account follow membership", () => {
  it("maps Helix followed channels into GuestFollow writes", () => {
    const follows = helixFollowedChannelsToGuestFollows([
      {
        channelId: "u1",
        channelLogin: "alice",
        displayName: "Alice",
        followedAt: "2017-01-01T00:00:00Z",
        platform: "twitch",
      },
    ]);
    expect(follows).toEqual([
      {
        channelId: "u1",
        channelLogin: "alice",
        displayName: "Alice",
        followedAt: "2017-01-01T00:00:00.000Z",
        platform: "twitch",
      },
    ]);
  });

  it("degrades when client id is missing", async () => {
    const source = createTwitchAccountFollowMembership({
      clientId: () => null,
      readCredential: async () => ({
        accessToken: "token",
        userId: "u1",
      }),
    });
    await expect(source.read()).resolves.toEqual({
      kind: "unavailable",
      reason: "twitch-client-id-missing",
    });
  });

});
