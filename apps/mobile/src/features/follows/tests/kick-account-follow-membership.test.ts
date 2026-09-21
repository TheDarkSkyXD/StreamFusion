import { describe, expect, it, vi } from "vitest";

import {
  createKickAccountFollowMembership,
  createKickAccountFollowMembershipUnavailable,
  fetchKickFollowedChannels,
  kickFollowedChannelsToGuestFollows,
  KICK_FOLLOWED_CHANNELS_URL,
  parseKickFollowedChannelsPayload,
} from "../adapters/kick-account-follow-membership";

describe("kick account follow membership", () => {
  it("maps legacy followed rows into GuestFollow writes", () => {
    const follows = kickFollowedChannelsToGuestFollows([
      {
        channelId: "411439",
        channelLogin: "summit1g",
        displayName: "Summit1G",
      },
    ]);
    expect(follows).toEqual([
      {
        channelId: "411439",
        channelLogin: "summit1g",
        displayName: "Summit1G",
        followedAt: "1970-01-01T00:00:00.000Z",
        platform: "kick",
      },
    ]);
  });

  it("parses Bearer { data: [...] } legacy payload", () => {
    expect(
      parseKickFollowedChannelsPayload({
        data: [
          {
            id: 411439,
            slug: "summit1g",
            user: { username: "Summit1G" },
          },
        ],
      }),
    ).toEqual([
      {
        channelId: "411439",
        channelLogin: "summit1g",
        displayName: "Summit1G",
      },
    ]);
  });

  it("parses Kick web { channels, nextCursor } page payload", () => {
    expect(
      parseKickFollowedChannelsPayload({
        channels: [
          {
            channel_slug: "xQc",
            user_username: "xQcOW",
            profile_picture: "https://files.kick.com/images/user/99/profile.webp",
          },
        ],
        nextCursor: 0,
      }),
    ).toEqual([
      {
        channelId: "99",
        channelLogin: "xqc",
        displayName: "xQcOW",
      },
    ]);
  });

  it("degrades when signed out", async () => {
    const source = createKickAccountFollowMembership({
      readCredential: async () => null,
    });
    await expect(source.read()).resolves.toEqual({
      kind: "unavailable",
      reason: "kick-signed-out",
    });
  });

  it("returns available follows when the catalog succeeds", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 1,
              slug: "alice",
              user: { username: "Alice" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const source = createKickAccountFollowMembership({
      fetch: fetch as unknown as typeof globalThis.fetch,
      readCredential: async () => ({ accessToken: "kick-token" }),
    });
    await expect(source.read()).resolves.toEqual({
      kind: "available",
      follows: [
        {
          channelId: "1",
          channelLogin: "alice",
          displayName: "Alice",
          followedAt: "1970-01-01T00:00:00.000Z",
          platform: "kick",
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      KICK_FOLLOWED_CHANNELS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer kick-token",
        }),
      }),
    );
  });

  it("classifies auth failure without breaking callers", async () => {
    await expect(
      fetchKickFollowedChannels({
        accessToken: "bad",
        fetch: async () => new Response("Unauthorized", { status: 401 }),
      }),
    ).resolves.toEqual({
      kind: "error",
      reason: "kick-followed-auth-failed",
    });
  });

  it("classifies Cloudflare HTML as a distinct failure", async () => {
    await expect(
      fetchKickFollowedChannels({
        accessToken: "tok",
        fetch: async () =>
          new Response("<!doctype html><title>Just a moment...</title>", {
            status: 200,
          }),
      }),
    ).resolves.toEqual({
      kind: "error",
      reason: "kick-followed-cloudflare",
    });
  });

  it("keeps the explicit unavailable stub for tests", async () => {
    await expect(
      createKickAccountFollowMembershipUnavailable().read(),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "kick-followed-unavailable",
    });
  });
});
