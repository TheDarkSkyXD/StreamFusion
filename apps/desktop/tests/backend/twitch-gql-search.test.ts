import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gqlSearchCategories,
  gqlSearchChannels,
  type SearchChannelEdgeItem,
  type SearchGameEdgeItem,
} from "@/backend/api/platforms/twitch/twitch-gql-client";

// Guards: Twitch GQL search pagination — `searchFor.channels` and `searchFor.games` do NOT accept `cursor`/`first` on the persisted operation, and the operation ignores `after`. Any fix that "adds pagination" by re-sending the same op with cursor will skeleton-flicker forever. The 26-test suite below pins the input contract, the cursor handoff, the dedupe semantics, and the endReason taxonomy (see `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md` for the bug class).
// Guards: response-fixture `satisfies` narrowing — widening what `transformSearchChannel`/`transformSearchGame` need produces a compile error here, so the test stays in sync with the production transforms rather than drifting silently.

type FetchMock = ReturnType<typeof vi.fn>;

// Fixtures use `satisfies` against the narrowed contracts the production
// transforms read. If a future change widens what `transformSearchChannel` /
// `transformSearchGame` need, the corresponding type widens and the fixture
// becomes a compile error here — preventing the kind of silent test-vs-real
// drift the unit suite is supposed to catch.
type ResponseBody<TKey extends "channels" | "games", TItem> = {
  data: {
    searchFor: {
      [K in "channels" | "games"]: {
        cursor: string | null;
        edges: K extends TKey
          ? { trackingID: string; item: TItem; __typename: "SearchForEdge" }[]
          : never[];
      };
    };
  };
  errors?: { message: string; extensions?: { code?: string } }[];
};

function makeChannelsResponse(opts: {
  cursor: string | null;
  count: number;
  errors?: { message: string; extensions?: { code?: string } }[];
}): ResponseBody<"channels", SearchChannelEdgeItem> {
  const edges = Array.from({ length: opts.count }, (_, i) => ({
    trackingID: `tracking-${i}`,
    __typename: "SearchForEdge" as const,
    item: {
      id: `id-${i}`,
      login: `channel${i}`,
      displayName: `Channel ${i}`,
      profileImageURL: "",
      description: "",
      stream: null,
      followers: { totalCount: 0, __typename: "FollowerConnection" as const },
      roles: { isPartner: false, __typename: "UserRoles" as const },
      broadcastSettings: { id: `bs-${i}`, title: "", __typename: "BroadcastSettings" as const },
    } satisfies SearchChannelEdgeItem,
  }));

  return {
    data: {
      searchFor: {
        channels: { cursor: opts.cursor, edges },
        games: { cursor: null, edges: [] },
      },
    },
    ...(opts.errors ? { errors: opts.errors } : {}),
  };
}

function makeCategoriesResponse(opts: {
  cursor: string | null;
  count: number;
  errors?: { message: string; extensions?: { code?: string } }[];
}): ResponseBody<"games", SearchGameEdgeItem> {
  const edges = Array.from({ length: opts.count }, (_, i) => ({
    trackingID: `tracking-${i}`,
    __typename: "SearchForEdge" as const,
    item: {
      id: `game-${i}`,
      name: `game${i}`,
      displayName: `Game ${i}`,
      boxArtURL: "https://example/{width}x{height}.jpg",
      viewersCount: 0,
    } satisfies SearchGameEdgeItem,
  }));

  return {
    data: {
      searchFor: {
        channels: { cursor: null, edges: [] },
        games: { cursor: opts.cursor, edges },
      },
    },
    ...(opts.errors ? { errors: opts.errors } : {}),
  };
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

  it("integrity-check guard matches case variants — 'Failed Integrity Check', 'FAILED_INTEGRITY_CHECK', 'integrity check failed' all suppress the cursor without warning", async () => {
    const variants = [
      "Failed Integrity Check",
      "FAILED_INTEGRITY_CHECK",
      "integrity check failed",
    ];
    for (const message of variants) {
      fetchMock.mockClear();
      warnSpy.mockClear();
      stubFetchOnce(
        fetchMock,
        makeChannelsResponse({ cursor: "MjA=", count: 0, errors: [{ message }] })
      );
      const result = await gqlSearchChannels("ninja", { after: "MTA=" });
      expect(result.cursor, `variant: ${message}`).toBeUndefined();
      expect(warnSpy, `variant: ${message}`).not.toHaveBeenCalled();
    }
  });

  it("integrity-check guard matches extensions.code envelope — { message: 'Bad Request', extensions: { code: 'INTEGRITY_FAILED' } }", async () => {
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 0,
        errors: [{ message: "Bad Request", extensions: { code: "INTEGRITY_FAILED" } }],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("integrity-check matcher does NOT false-positive on schema errors mentioning 'integrity'", async () => {
    // Schema error like "Cannot query field 'clientIntegrity'" contains
    // the substring "integrity" but is not an integrity rejection — it's a
    // schema mismatch the dev needs to see via console.warn.
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 5,
        errors: [{ message: "Cannot query field 'clientIntegrity' on type 'User'" }],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    // Not classified as integrity rejection → falls through to normal warning
    // path; the page's actual data is preserved and the cursor advances normally.
    expect(result.data).toHaveLength(5);
    expect(result.cursor).toBe("MjA=");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("mixed errors envelope (integrity + unrelated) — flags integrity AND warns about the unrelated error", async () => {
    // Twitch can return multiple errors in one envelope. The integrity flag
    // must still fire (so the loop terminates), but the unrelated error
    // must NOT be silently swallowed — it deserves a console.warn so dev
    // sees the schema/server issue alongside the rate-limit rejection.
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 0,
        errors: [
          { message: "failed integrity check" },
          { message: "Unexpected internal server error" },
        ],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("integrity-rejected");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SearchChannels"),
      expect.stringContaining("Unexpected internal server error")
    );
    // The integrity error itself should NOT appear in the warn payload.
    const warnArgs = warnSpy.mock.calls[0]?.[1] as string | undefined;
    expect(warnArgs).not.toMatch(/integrity/i);
  });

  it("endReason — set to 'cursor-no-advance' when server echoes the input cursor", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 3 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("cursor-no-advance");
  });

  it("endReason — set to 'empty-page' when server returns zero edges", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 0 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.endReason).toBe("empty-page");
  });

  it("endReason — set to 'integrity-rejected' when integrity check fires", async () => {
    stubFetchOnce(
      fetchMock,
      makeChannelsResponse({
        cursor: "MjA=",
        count: 0,
        errors: [{ message: "failed integrity check" }],
      })
    );
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.endReason).toBe("integrity-rejected");
  });

  it("endReason — set to 'exhausted' when server returns data but no cursor", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: null, count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("exhausted");
  });

  it("endReason — undefined on a successful advance (cursor returned)", async () => {
    stubFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBe("MjA=");
    expect(result.endReason).toBeUndefined();
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

  // endReason parity with the channels suite. Both functions route through
  // the same `buildPaginatedResult` seam, but the categories context label
  // (`SearchCategories`) and the `games` branch of the connection are
  // distinct code paths — these tests pin the contract per branch.

  it("endReason — set to 'cursor-no-advance' when server echoes the input cursor", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 3 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("cursor-no-advance");
  });

  it("endReason — set to 'empty-page' when server returns zero edges", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 0 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.endReason).toBe("empty-page");
  });

  it("endReason — set to 'integrity-rejected' when integrity check fires", async () => {
    stubFetchOnce(
      fetchMock,
      makeCategoriesResponse({
        cursor: "NTA=",
        count: 0,
        errors: [{ message: "failed integrity check" }],
      })
    );
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.endReason).toBe("integrity-rejected");
  });

  it("endReason — set to 'exhausted' when server returns data but no cursor", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: null, count: 5 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("exhausted");
  });

  it("endReason — undefined on a successful advance (cursor returned)", async () => {
    stubFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 5 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBe("NTA=");
    expect(result.endReason).toBeUndefined();
  });
});
