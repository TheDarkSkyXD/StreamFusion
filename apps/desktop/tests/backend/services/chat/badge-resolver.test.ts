import { afterEach, describe, expect, it, vi } from "vitest";

import { BadgeResolver } from "@backend/services/chat/badge-resolver";
import type { ChatBadge, TwitchBadgeCatalog } from "@shared/chat-types";

// Guards: BadgeResolver cache identity — same badge set + same broadcasterId returns the SAME array reference (React render stability); different broadcasterId or set/version returns a different reference (no stale-channel bleed); clearCache drops the memo. Reference-equality matters because consumers use it as a React key signal.
// Guards: Twitch channel badge fetches keep every subscriber version so subscriber/0 and subscriber/12 resolve to the watched channel's images.
// Guards: Twitch channel badge fetches prefer Xtra-style broadcastBadges GQL data so custom subscriber badges win before Helix fallback.
// Guards: forced channel badge refreshes replace stale resolved subscriber badge images so broadcaster badge updates appear without restarting the app.
// Guards: serialized badge hydration keeps channel-over-global precedence, evicts the oldest channel after 20, and preserves known-good images after a failed refresh.
// Guards: unresolved badge memoization includes original image/title so retained enriched rows cannot be replaced by a stale unresolved tuple.

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

  it("does not reuse a cached unresolved badge when its original image or title changes", () => {
    const resolver = new BadgeResolver();
    const first = resolver.resolveBadges([
      { setId: "custom", version: "1", imageUrl: "", title: "Old title" },
    ]);
    const second = resolver.resolveBadges([
      {
        setId: "custom",
        version: "1",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/custom/3",
        title: "New title",
      },
    ]);

    expect(second).not.toBe(first);
    expect(second[0]).toMatchObject({
      imageUrl: "https://static-cdn.jtvnw.net/badges/v1/custom/3",
      title: "New title",
    });
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

  it("filters malformed or non-HTTPS badge entries instead of inventing an image URL", async () => {
    const resolver = new BadgeResolver();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            user: {
              broadcastBadges: [
                {
                  setID: "subscriber",
                  version: "0",
                  imageURL: "http://insecure.example/subscriber.png",
                  title: "Subscriber",
                },
                {
                  setID: "",
                  version: "1",
                  imageURL: "https://static-cdn.jtvnw.net/badges/v1/missing-set/3",
                  title: "Missing set",
                },
                {
                  setID: "moderator",
                  version: "1",
                  imageURL: "https://static-cdn.jtvnw.net/badges/v1/moderator/3",
                  title: "Moderator",
                },
              ],
            },
          },
        }),
      }))
    );

    await expect(
      resolver.loadChannelBadges("111", "", "", "ninja", { forceRefresh: true })
    ).resolves.toBe(true);

    const originalSubscriber = {
      setId: "subscriber",
      version: "0",
      imageUrl: "",
      title: "subscriber",
    };
    expect(resolver.resolveBadge(originalSubscriber, "111")).toBe(originalSubscriber);
    expect(
      resolver.resolveBadge(
        { setId: "moderator", version: "1", imageUrl: "", title: "" },
        "111"
      ).imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/moderator/3");
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

  it("hydrates channel badges over globals and evicts the oldest channel after twenty", () => {
    const resolver = new BadgeResolver();
    const catalog = (index: number): TwitchBadgeCatalog => ({
      global: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/global-sub/3",
            title: "Global Subscriber",
          },
        ],
      },
      channel: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: `https://static-cdn.jtvnw.net/badges/v1/channel-${index}/3`,
            title: `Channel ${index} Subscriber`,
          },
        ],
      },
    });

    for (let index = 1; index <= 21; index += 1) {
      resolver.hydrateBadgeCatalog(String(index), catalog(index));
    }

    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "0", imageUrl: "", title: "" }],
        "1"
      )[0].imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/global-sub/3");
    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "0", imageUrl: "", title: "" }],
        "21"
      )[0].imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/channel-21/3");
  });

  it("promotes a channel cache hit so the least recently used channel is evicted", async () => {
    const resolver = new BadgeResolver();
    const catalog = (index: number): TwitchBadgeCatalog => ({
      global: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/global-sub/3",
            title: "Global Subscriber",
          },
        ],
      },
      channel: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: `https://static-cdn.jtvnw.net/badges/v1/channel-${index}/3`,
            title: `Channel ${index} Subscriber`,
          },
        ],
      },
    });

    for (let index = 1; index <= 20; index += 1) {
      resolver.hydrateBadgeCatalog(String(index), catalog(index));
    }
    await expect(resolver.loadBadgeCatalog("1", "channelone")).resolves.not.toBeNull();
    resolver.hydrateBadgeCatalog("21", catalog(21));

    expect(
      resolver.resolveBadge(
        { setId: "subscriber", version: "0", imageUrl: "", title: "" },
        "1"
      ).imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/channel-1/3");
    expect(
      resolver.resolveBadge(
        { setId: "subscriber", version: "0", imageUrl: "", title: "" },
        "2"
      ).imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/global-sub/3");
  });

  it("keeps the last known-good catalog when a forced refresh fails", async () => {
    const resolver = new BadgeResolver();
    resolver.hydrateBadgeCatalog("111", {
      global: {
        source: "gql",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/known-global/3",
            title: "Moderator",
          },
        ],
      },
      channel: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/known-channel/3",
            title: "Subscriber",
          },
        ],
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    await expect(
      resolver.loadBadgeCatalog("111", "ninja", "", "", { forceRefresh: true })
    ).resolves.toBeNull();

    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "0", imageUrl: "", title: "retained" }],
        "111"
      )[0].imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/known-channel/3");
    expect(
      resolver.resolveBadges([
        { setId: "moderator", version: "1", imageUrl: "", title: "retained" },
      ])[0].imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/known-global/3");
  });

  it("does not replace known-good badges when every global source is empty or malformed", async () => {
    const resolver = new BadgeResolver();
    resolver.hydrateBadgeCatalog("111", {
      global: {
        source: "gql",
        badges: [
          {
            setId: "moderator",
            version: "1",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/known-global/3",
            title: "Moderator",
          },
        ],
      },
      channel: {
        source: "gql",
        badges: [
          {
            setId: "subscriber",
            version: "0",
            imageUrl: "https://static-cdn.jtvnw.net/badges/v1/known-channel/3",
            title: "Subscriber",
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://api.twitch.tv/helix/")) {
          return { ok: true, json: async () => ({ data: [] }) };
        }
        const operationName = JSON.parse(String(init?.body)).operationName as string;
        if (operationName === "Badges") {
          return {
            ok: true,
            json: async () => ({
              data: {
                badges: [
                  {
                    setID: "moderator",
                    version: "1",
                    imageURL: "http://insecure.example/moderator.png",
                    title: "Moderator",
                  },
                ],
              },
            }),
          };
        }
        if (operationName === "UserBadges") {
          return {
            ok: true,
            json: async () => ({
              data: {
                user: {
                  broadcastBadges: [
                    {
                      setID: "subscriber",
                      version: "0",
                      imageURL: "https://static-cdn.jtvnw.net/badges/v1/new-channel/3",
                      title: "Subscriber",
                    },
                  ],
                },
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: { badges: [] } }) };
      })
    );

    await expect(
      resolver.loadBadgeCatalog("111", "ninja", "real-token", "real-client-id", {
        forceRefresh: true,
      })
    ).resolves.toBeNull();
    expect(
      resolver.resolveBadge(
        { setId: "moderator", version: "1", imageUrl: "", title: "" },
        "111"
      ).imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/known-global/3");
    expect(
      resolver.resolveBadge(
        { setId: "subscriber", version: "0", imageUrl: "", title: "" },
        "111"
      ).imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/known-channel/3");
  });

  it("returns a complete cached catalog until force refresh is requested", async () => {
    const resolver = new BadgeResolver();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const operationName = JSON.parse(String(init?.body)).operationName as string;
      const badge = {
        setID: operationName === "Badges" ? "moderator" : "subscriber",
        version: operationName === "Badges" ? "1" : "0",
        imageURL: `https://static-cdn.jtvnw.net/badges/v1/${operationName}/3`,
        title: operationName === "Badges" ? "Moderator" : "Subscriber",
      };
      return {
        ok: true,
        json: async () =>
          operationName === "Badges"
            ? { data: { badges: [badge] } }
            : { data: { user: { broadcastBadges: [badge] } } },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolver.loadBadgeCatalog("111", "ninja");
    const cached = await resolver.loadBadgeCatalog("111", "ninja");
    const forced = await resolver.loadBadgeCatalog("111", "ninja", "", "", {
      forceRefresh: true,
    });

    expect(first).toEqual(cached);
    expect(forced).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not attempt Helix when both channel GQL sources fail without credentials", async () => {
    const resolver = new BadgeResolver();
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolver.loadChannelBadges("111", "", "", "ninja")).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === "https://gql.twitch.tv/gql")).toBe(true);
  });

  it("uses Helix only after both channel GQL sources fail with valid credentials", async () => {
    const resolver = new BadgeResolver();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "https://gql.twitch.tv/gql") {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              set_id: "subscriber",
              versions: [
                {
                  id: "0",
                  image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/helix-sub/1",
                  image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/helix-sub/2",
                  image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/helix-sub/3",
                  title: "Subscriber",
                },
              ],
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolver.loadChannelBadges("111", "real-token", "real-client-id", "ninja")
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.twitch.tv/helix/chat/badges?broadcaster_id=111"
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer real-token",
        "Client-Id": "real-client-id",
      },
    });
    expect(
      resolver.resolveBadges(
        [{ setId: "subscriber", version: "0", imageUrl: "", title: "" }],
        "111"
      )[0].imageUrl
    ).toBe("https://static-cdn.jtvnw.net/badges/v1/helix-sub/3");
  });
});
