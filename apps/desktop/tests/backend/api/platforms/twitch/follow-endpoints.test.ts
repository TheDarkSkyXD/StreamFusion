import { describe, expect, it, vi } from "vitest";

import { writeTwitchAccountFollow } from "@/backend/api/platforms/twitch/endpoints/follow-endpoints";

// Guards: an authenticated Twitch follow uses the Xtra-compatible persisted mutation and
// remains unconfirmed until the caller reconciles the authoritative followed-channel list.
describe("Twitch account follow endpoint", () => {
  it("submits the Xtra-compatible follow mutation as an accepted, not confirmed, write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { followUser: { follow: { followedAt: "now" } } } }), {
        status: 200,
      })
    );

    await expect(
      writeTwitchAccountFollow(
        {
          action: "follow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "test-token" },
        },
        { fetch: fetchMock }
      )
    ).resolves.toEqual({ status: "accepted" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gql.twitch.tv/gql");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      Authorization: "OAuth test-token",
      "Client-Id": "xtra-client",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      extensions: {
        persistedQuery: {
          sha256Hash: "800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08",
          version: 1,
        },
      },
      operationName: "FollowButton_FollowUser",
      variables: {
        input: {
          disableNotifications: false,
          targetID: "141981764",
        },
      },
    });
  });

  it("submits the Xtra-compatible unfollow mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { unfollowUser: { follow: null } } }), { status: 200 })
      );

    await expect(
      writeTwitchAccountFollow(
        {
          action: "unfollow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "test-token" },
        },
        { fetch: fetchMock }
      )
    ).resolves.toEqual({ status: "accepted" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      extensions: {
        persistedQuery: {
          sha256Hash: "f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880",
          version: 1,
        },
      },
      operationName: "FollowButton_UnfollowUser",
      variables: { input: { targetID: "141981764" } },
    });
  });

  it("classifies an unauthorized credential as a reconnect requirement", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), { status: 401 })
      );

    await expect(
      writeTwitchAccountFollow(
        {
          action: "follow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "expired-test-token" },
        },
        { fetch: fetchMock }
      )
    ).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Reconnect Twitch follow access, then try again.",
    });
  });

  it("classifies a transient Twitch outage without reporting success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      writeTwitchAccountFollow(
        {
          action: "unfollow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "test-token" },
        },
        { fetch: fetchMock }
      )
    ).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "transient",
      message: "Twitch could not confirm the follow change. Try again.",
    });
  });

  it("classifies a network failure without exposing a low-level fetch error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      writeTwitchAccountFollow(
        {
          action: "follow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "test-token" },
        },
        { fetch: fetchMock }
      )
    ).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "transient",
      message: "Twitch could not confirm the follow change. Try again.",
    });
  });

  it("classifies a GraphQL authorization rejection as a reconnect requirement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "failed integrity check" }] }), {
        status: 200,
      })
    );

    await expect(
      writeTwitchAccountFollow(
        {
          action: "follow",
          channelId: "141981764",
          credential: { clientId: "xtra-client", accessToken: "test-token" },
        },
        { fetch: fetchMock }
      )
    ).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Reconnect Twitch follow access, then try again.",
    });
  });
});
