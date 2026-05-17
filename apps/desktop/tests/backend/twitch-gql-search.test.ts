import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gqlSearchCategories,
  gqlSearchChannels,
} from "@/backend/api/platforms/twitch/twitch-gql-client";

type FetchMock = ReturnType<typeof vi.fn>;

function makeChannelsResponse(opts: {
  cursor: string | null;
  count: number;
  errors?: { message: string }[];
}) {
  const edges = Array.from({ length: opts.count }, (_, i) => ({
    trackingID: `tracking-${i}`,
    __typename: "SearchForEdge",
    item: {
      id: `id-${i}`,
      login: `channel${i}`,
      displayName: `Channel ${i}`,
      profileImageURL: "",
      description: "",
      stream: null,
      followers: { totalCount: 0 },
      roles: { isPartner: false, __typename: "UserRoles" },
      broadcastSettings: { title: "" },
    },
  }));

  const body: Record<string, unknown> = {
    data: {
      searchFor: {
        banners: null,
        channels: {
          cursor: opts.cursor,
          edges,
          score: null,
          totalMatches: 100,
          __typename: "SearchForResultUsers",
        },
        channelsWithTag: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultUsers",
        },
        games: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultGames",
        },
        videos: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultVideos",
        },
        relatedLiveChannels: {
          edges: [],
          score: null,
          __typename: "SearchForResultRelatedLiveChannels",
        },
        __typename: "SearchFor",
      },
    },
  };

  if (opts.errors) body.errors = opts.errors;

  return body;
}

function makeCategoriesResponse(opts: {
  cursor: string | null;
  count: number;
  errors?: { message: string }[];
}) {
  const edges = Array.from({ length: opts.count }, (_, i) => ({
    trackingID: `tracking-${i}`,
    __typename: "SearchForEdge",
    item: {
      id: `game-${i}`,
      name: `game${i}`,
      displayName: `Game ${i}`,
      boxArtURL: "https://example/{width}x{height}.jpg",
      viewersCount: 0,
    },
  }));

  const body: Record<string, unknown> = {
    data: {
      searchFor: {
        banners: null,
        channels: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultUsers",
        },
        channelsWithTag: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultUsers",
        },
        games: {
          cursor: opts.cursor,
          edges,
          score: null,
          totalMatches: 50,
          __typename: "SearchForResultGames",
        },
        videos: {
          cursor: null,
          edges: [],
          score: null,
          totalMatches: 0,
          __typename: "SearchForResultVideos",
        },
        relatedLiveChannels: {
          edges: [],
          score: null,
          __typename: "SearchForResultRelatedLiveChannels",
        },
        __typename: "SearchFor",
      },
    },
  };

  if (opts.errors) body.errors = opts.errors;

  return body;
}

function stubFetchOnce(fetchMock: FetchMock, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => [body],
  } as Response);
}

describe("gqlSearchChannels — safety properties", () => {
  let fetchMock: FetchMock;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it("happy path — returns data + advanced cursor on page 2", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.data).toHaveLength(5);
    expect(result.cursor).toBe("MjA=");
  });

  it("cursor-no-advance guard — returns cursor: undefined when server returns same cursor as input", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 3 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
  });

  it("empty-page guard — returns cursor: undefined when edges is empty", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 0 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.data).toHaveLength(0);
    expect(result.cursor).toBeUndefined();
  });

  it('integrity-check guard — returns cursor: undefined on "failed integrity check" without warning', async () => {
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 0,
        errors: [{ message: "failed integrity check" }],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("other GraphQL errors — returns cursor: undefined AND warns so dev sees the problem", async () => {
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 0,
        errors: [{ message: "Unexpected server error" }],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("page 1 (no after) returns the server cursor so page 2 can be attempted via raw GQL", async () => {
    // Page 1 returns the server's cursor so the React Query infinite hook can
    // call fetchNextPage with after=<cursor>, which routes through the raw-GQL
    // LoadMore branch on the second call. If raw GQL fails or the cursor doesn't
    // advance, the guards report end-of-list. Page 1 itself must hand off the
    // cursor for that handoff to be possible.
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 10 }));
    const result = await gqlSearchChannels("ninja");

    expect(result.data).toHaveLength(10);
    expect(result.cursor).toBe("MTA=");
  });
});

describe("gqlSearchCategories — safety properties", () => {
  let fetchMock: FetchMock;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it("happy path — returns data + advanced cursor on page 2", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 4 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.data).toHaveLength(4);
    expect(result.cursor).toBe("NTA=");
  });

  it("cursor-no-advance guard — returns cursor: undefined when server returns same cursor as input", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 3 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.cursor).toBeUndefined();
  });

  it("empty-page guard — returns cursor: undefined when edges is empty", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 0 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.data).toHaveLength(0);
    expect(result.cursor).toBeUndefined();
  });

  it('integrity-check guard — returns cursor: undefined on "failed integrity check" without warning', async () => {
    stubFetchOnce(
      fetchMock,
      makeCategoriesResponse({
        cursor: "NTA=",
        count: 0,
        errors: [{ message: "failed integrity check" }],
      })
    );
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("page 1 (no after) returns the server cursor so page 2 can be attempted via raw GQL", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 10 }));
    const result = await gqlSearchCategories("chess");

    expect(result.data).toHaveLength(10);
    expect(result.cursor).toBe("MjA=");
  });
});
