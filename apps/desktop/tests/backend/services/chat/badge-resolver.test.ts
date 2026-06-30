import { afterEach, describe, expect, it, vi } from "vitest";

import { BadgeResolver } from "@/backend/services/chat/badge-resolver";
import type { ChatBadge } from "@/shared/chat-types";

// Guards: BadgeResolver cache identity — same badge set + same broadcasterId returns the SAME array reference (React render stability); different broadcasterId or set/version returns a different reference (no stale-channel bleed); clearCache drops the memo. Reference-equality matters because consumers use it as a React key signal.
// Guards: Twitch channel badge fetches keep every subscriber version so subscriber/0 and subscriber/12 resolve to the watched channel's images.
// Guards: Twitch channel badge fetches prefer Xtra-style broadcastBadges GQL data so custom subscriber badges win before Helix fallback.
// Guards: forced channel badge refreshes replace stale resolved subscriber badge images so broadcaster badge updates appear without restarting the app.

function makeBadges(): ChatBadge[] {
  return [
    { setId: "subscriber", version: "6", imageUrl: "", title: "" },
    { setId: "moderator", version: "1", imageUrl: "", title: "" },
  ];
}

describe("BadgeResolver.resolveBadges", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the same array reference for identical inputs", () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    const b = resolver.resolveBadges(makeBadges());
    expect(b).toBe(a);
  });

  it("returns equivalent values for distinct calls", () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    const b = resolver.resolveBadges(makeBadges());
    // Same array reference and same per-element identity (since it's literally
    // the same array object).
    expect(a).toBe(b);
    expect(a.length).toBe(2);
  });

  it("returns distinct references when broadcasterId differs", () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges(), "channel-1");
    const b = resolver.resolveBadges(makeBadges(), "channel-2");
    expect(b).not.toBe(a);
  });

  it("returns distinct references when set/version differs", () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges([
      { setId: "subscriber", version: "6", imageUrl: "", title: "" },
    ]);
    const b = resolver.resolveBadges([
      { setId: "subscriber", version: "12", imageUrl: "", title: "" },
    ]);
    expect(b).not.toBe(a);
  });

  it("drops the cache after clearCache()", () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    resolver.clearCache();
    const b = resolver.resolveBadges(makeBadges());
    expect(b).not.toBe(a);
  });

  it("handles empty badges arrays without caching", () => {
    const resolver = new BadgeResolver();
    const empty: ChatBadge[] = [];
    expect(resolver.resolveBadges(empty)).toBe(empty);
  });

  it("resolves every channel subscriber badge version returned by Twitch", async () => {
    const resolver = new BadgeResolver();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              set_id: "subscriber",
              versions: [
                {
                  id: "0",
                  image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/sub-0/1",
                  image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/sub-0/2",
                  image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/sub-0/3",
                  title: "Subscriber",
                  description: "1-Month Subscriber",
                  click_action: null,
                  click_url: null,
                },
                {
                  id: "12",
                  image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/sub-12/1",
                  image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/sub-12/2",
                  image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/sub-12/3",
                  title: "1-Year Subscriber",
                  description: "12-Month Subscriber",
                  click_action: null,
                  click_url: null,
                },
              ],
            },
          ],
        }),
      }))
    );

    await resolver.loadChannelBadges("ninja-id", "token", "client-id");

    expect(
      resolver.resolveBadges(
        [
          { setId: "subscriber", version: "0", imageUrl: "", title: "subscriber" },
          { setId: "subscriber", version: "12", imageUrl: "", title: "subscriber" },
        ],
        "ninja-id"
      )
    ).toEqual([
      {
        setId: "subscriber",
        version: "0",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/sub-0/3",
        title: "Subscriber",
      },
      {
        setId: "subscriber",
        version: "12",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/sub-12/3",
        title: "1-Year Subscriber",
      },
    ]);
  });

  it("prefers custom broadcastBadges from Twitch GQL for channel subscriber badges", async () => {
    const resolver = new BadgeResolver();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            broadcastBadges: [
              {
                setID: "subscriber",
                version: "3",
                imageURL: "https://static-cdn.jtvnw.net/badges/v1/custom-extraemily-sub-3/3",
                title: "3-Month Subscriber",
              },
            ],
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await resolver.loadChannelBadges("517475551", "token", "client-id", "extraemily");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gql.twitch.tv/gql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
          "Content-Type": "application/json",
        }),
      })
    );
    const [[, gqlRequest]] = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(gqlRequest.body))).toMatchObject({
      operationName: "UserBadges",
      variables: { id: "517475551", quality: "QUADRUPLE" },
    });
    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "3", imageUrl: "", title: "subscriber" }],
        "517475551"
      )
    ).toEqual([
      {
        setId: "subscriber",
        version: "3",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/custom-extraemily-sub-3/3",
        title: "3-Month Subscriber",
      },
    ]);
  });

  it("force-refreshes channel badges and invalidates cached resolved badge images", async () => {
    const resolver = new BadgeResolver();
    let imageUrl = "https://static-cdn.jtvnw.net/badges/v1/old-custom-sub-3/3";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            broadcastBadges: [
              {
                setID: "subscriber",
                version: "3",
                imageURL: imageUrl,
                title: "3-Month Subscriber",
              },
            ],
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await resolver.loadChannelBadges("517475551", "token", "client-id", "extraemily");
    const firstResolved = resolver.resolveBadges(
      [{ setId: "subscriber", version: "3", imageUrl: "", title: "subscriber" }],
      "517475551"
    );
    expect(firstResolved[0].imageUrl).toBe(
      "https://static-cdn.jtvnw.net/badges/v1/old-custom-sub-3/3"
    );

    imageUrl = "https://static-cdn.jtvnw.net/badges/v1/new-custom-sub-3/3";
    await resolver.loadChannelBadges("517475551", "token", "client-id", "extraemily");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "3", imageUrl: "", title: "subscriber" }],
        "517475551"
      )
    ).toBe(firstResolved);

    await resolver.loadChannelBadges("517475551", "token", "client-id", "extraemily", {
      forceRefresh: true,
    });
    const refreshedResolved = resolver.resolveBadges(
      [{ setId: "subscriber", version: "3", imageUrl: "", title: "subscriber" }],
      "517475551"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshedResolved).not.toBe(firstResolved);
    expect(refreshedResolved[0].imageUrl).toBe(
      "https://static-cdn.jtvnw.net/badges/v1/new-custom-sub-3/3"
    );
  });
});
