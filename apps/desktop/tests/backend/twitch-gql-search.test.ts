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

function lastFetchBody(fetchMock: FetchMock): string {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ?? "";
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

  it("happy path — page 2 hits the raw-GQL LoadMore query (not the persisted op) and returns advanced cursor", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.data).toHaveLength(5);
    expect(result.cursor).toBe("MjA=");

    // Path-discrimination: the page-2 request must hit the raw-GQL LoadMore
    // query body. If a refactor routes after-bearing calls back through the
    // persisted op, the skeleton-flicker bug returns silently — this guard
    // catches that regression.
    const body = lastFetchBody(fetchMock);
    expect(body).toContain("SearchResultsPageLoadMoreChannels");
    expect(body).not.toContain("persistedQuery");
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

  it("other GraphQL errors — warns with SearchChannels context label AND the propagated error message", async () => {
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
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SearchChannels"),
      expect.stringContaining("Unexpected server error")
    );
  });

  it("page 1 (no after) hits the persisted query and returns the server cursor for page-2 hand-off", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 10 }));
    const result = await gqlSearchChannels("ninja");

    expect(result.data).toHaveLength(10);
    expect(result.cursor).toBe("MTA=");

    // Path-discrimination: page 1 must use the persisted op (known-good for
    // anonymous reads); raw-GQL is reserved for page 2+.
    const body = lastFetchBody(fetchMock);
    expect(body).toContain("persistedQuery");
    expect(body).toContain("sha256Hash");
    expect(body).not.toContain("SearchResultsPageLoadMoreChannels");
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

  it("happy path — page 2 hits the raw-GQL LoadMore query (not the persisted op) and returns advanced cursor", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 4 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.data).toHaveLength(4);
    expect(result.cursor).toBe("NTA=");

    const body = lastFetchBody(fetchMock);
    expect(body).toContain("SearchResultsPageLoadMoreGames");
    expect(body).not.toContain("persistedQuery");
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

  it("other GraphQL errors — warns with SearchCategories context label AND the propagated error message", async () => {
    stubFetchOnce(
      fetchMock,
      makeCategoriesResponse({
        cursor: "NTA=",
        count: 0,
        errors: [{ message: "Unexpected server error" }],
      })
    );
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SearchCategories"),
      expect.stringContaining("Unexpected server error")
    );
  });

  it("page 1 (no after) hits the persisted query and returns the server cursor for page-2 hand-off", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 10 }));
    const result = await gqlSearchCategories("chess");

    expect(result.data).toHaveLength(10);
    expect(result.cursor).toBe("MjA=");

    const body = lastFetchBody(fetchMock);
    expect(body).toContain("persistedQuery");
    expect(body).toContain("sha256Hash");
    expect(body).not.toContain("SearchResultsPageLoadMoreGames");
  });
});
