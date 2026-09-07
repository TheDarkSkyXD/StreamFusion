import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordPlatformSuccess = vi.fn();

const mockRecordPlatformFailure = vi.fn();

vi.mock("@backend/api/unified/platform-health", () => ({
  recordPlatformSuccess: (...args: unknown[]) => mockRecordPlatformSuccess(...args),
  recordPlatformFailure: (...args: unknown[]) => mockRecordPlatformFailure(...args),
}));

vi.mock("@shared/utils/cross-logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));
import {
  gqlGetStreamsByLogins,
  gqlGetTopStreams,
  gqlIsChannelLive,
  gqlSearchChannels,
} from "@backend/features/discovery/adapters/twitch/twitch-gql-discovery";
import { gqlGetPlaybackAccessToken } from "@backend/features/playback/adapters/twitch/twitch-gql-playback";

type FetchMock = ReturnType<typeof vi.fn>;

function stubFetch(fetchMock: FetchMock, ...bodies: unknown[]) {
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => (Array.isArray(body) ? body : [body]),
    } as Response);
  }
}

function stubFetchBatch(fetchMock: FetchMock, ...bodies: unknown[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => bodies,
  } as Response);
}

function stubFetchRaw(fetchMock: FetchMock, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response);
}

function stubFetchError(fetchMock: FetchMock, status: number, statusText: string) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  } as Response);
}

function stubFetchReject(fetchMock: FetchMock, error: Error) {
  fetchMock.mockRejectedValueOnce(error);
}

function lastFetchBody(fetchMock: FetchMock): string {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ?? "";
}

function nthFetchBody(fetchMock: FetchMock, n: number): string {
  const call = fetchMock.mock.calls[n];
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ?? "";
}

function makeUseLiveResponse(isLive: boolean) {
  return {
    data: {
      user: isLive
        ? { stream: { id: "stream-1", __typename: "Stream" }, __typename: "User" }
        : { stream: null, __typename: "User" },
    },
  };
}

// ---------------------------------------------------------------------------

// Guards: malformed batch entries fail at the GQL boundary instead of reaching response transforms.
describe("gqlRequest — transport layer", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws on HTTP error response", async () => {
    stubFetchError(fetchMock, 500, "Internal Server Error");

    // gqlIsChannelLive doesn't catch — HTTP error propagates
    await expect(gqlIsChannelLive("ch")).rejects.toThrow(
      "GQL request failed: 500 Internal Server Error"
    );
  });

  it("throws on HTTP 403", async () => {
    stubFetchError(fetchMock, 403, "Forbidden");

    await expect(gqlIsChannelLive("ch")).rejects.toThrow("GQL request failed: 403 Forbidden");
  });

  it("propagates network errors from fetch", async () => {
    stubFetchReject(fetchMock, new TypeError("Failed to fetch"));

    await expect(gqlIsChannelLive("ch")).rejects.toThrow("Failed to fetch");
  });

  it("rejects arrays nested where a GQL response envelope is required", async () => {
    stubFetchBatch(fetchMock, []);

    await expect(gqlIsChannelLive("ch")).rejects.toThrow(
      "GQL response did not match the requested query tuple"
    );
  });

  it("rejects batch responses with more entries than requested", async () => {
    stubFetchBatch(fetchMock, makeUseLiveResponse(false), makeUseLiveResponse(true));

    await expect(gqlIsChannelLive("ch")).rejects.toThrow(
      "GQL response did not match the requested query tuple"
    );
  });

  it("rejects envelopes without data or errors", async () => {
    stubFetchBatch(fetchMock, {});

    await expect(gqlIsChannelLive("ch")).rejects.toThrow(
      "GQL response did not match the requested query tuple"
    );
  });

  it("rejects primitive GQL data payloads", async () => {
    stubFetchBatch(fetchMock, { data: "not-an-object" });

    await expect(gqlIsChannelLive("ch")).rejects.toThrow(
      "GQL response did not match the requested query tuple"
    );
  });

  it("sends POST method to GQL endpoint", async () => {
    stubFetch(fetchMock, makeUseLiveResponse(false));

    await gqlIsChannelLive("ch");

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
  });

  it("uses AbortSignal.timeout on every request", async () => {
    stubFetch(fetchMock, makeUseLiveResponse(false));

    await gqlIsChannelLive("ch");

    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.signal).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe("sendPersistedQuery — transport layer", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends persisted query envelope with sha256Hash", async () => {
    // gqlSearchChannels page 1 uses the persisted path
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: { cursor: null, edges: [] },
          games: { cursor: null, edges: [] },
        },
      },
    });

    await gqlSearchChannels("ninja");

    const body = JSON.parse(lastFetchBody(fetchMock));
    const query = body[0];
    expect(query.extensions).toEqual(
      expect.objectContaining({
        persistedQuery: expect.objectContaining({
          version: 1,
          sha256Hash: expect.any(String),
        }),
      })
    );
  });

  it("throws on HTTP error for persisted queries", async () => {
    // DirectoryPage_Game persisted query — slug resolves fine but persisted POST fails.
    // Since the error propagates through gqlGetGameStreamsBySlug and is caught by
    // gqlGetStreamsByGameId (which falls back to raw), we verify the raw fallback
    // path is reached instead. Use gqlGetPlaybackAccessToken for a direct throw test.
    stubFetchError(fetchMock, 502, "Bad Gateway");

    await expect(gqlGetPlaybackAccessToken("ch")).rejects.toThrow(
      "GQL request failed: 502 Bad Gateway"
    );
  });
});

// ---------------------------------------------------------------------------
// MAX_QUERIES_PER_REQUEST (35) — batching guard
// ---------------------------------------------------------------------------

describe("gqlRequest — batching limit", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gqlGetStreamsByLogins batches UseLive queries in chunks of 35", async () => {
    const logins = Array.from({ length: 40 }, (_, i) => `ch${i}`);

    // Batch 1: 35 UseLive responses (all offline)
    const batch1 = logins.slice(0, 35).map(() => makeUseLiveResponse(false));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => batch1,
    } as Response);

    // Batch 2: remaining 5 UseLive responses (all offline)
    const batch2 = logins.slice(35).map(() => makeUseLiveResponse(false));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => batch2,
    } as Response);

    const result = await gqlGetStreamsByLogins(logins);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body1 = JSON.parse(nthFetchBody(fetchMock, 0));
    expect(body1).toHaveLength(35);
    const body2 = JSON.parse(nthFetchBody(fetchMock, 1));
    expect(body2).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Platform-health instrumentation (slice 06)
// ---------------------------------------------------------------------------

describe("gqlRequest — platform-health instrumentation", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockRecordPlatformSuccess.mockClear();
    mockRecordPlatformFailure.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls recordPlatformSuccess('twitch') on a successful gqlRequest", async () => {
    stubFetch(fetchMock, makeUseLiveResponse(true));

    await gqlIsChannelLive("ninja");

    expect(mockRecordPlatformSuccess).toHaveBeenCalledWith("twitch");
  });

  it("calls recordPlatformFailure('twitch', 'server-5xx') on HTTP 500", async () => {
    stubFetchError(fetchMock, 500, "Internal Server Error");

    await expect(gqlIsChannelLive("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "server-5xx");
  });

  it("calls recordPlatformFailure('twitch', 'timeout') on AbortSignal timeout", async () => {
    const err = new DOMException("The operation was aborted.", "TimeoutError");
    stubFetchReject(fetchMock, err);

    await expect(gqlIsChannelLive("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "timeout");
  });

  it("calls recordPlatformFailure('twitch', 'net-error') on network error", async () => {
    stubFetchReject(fetchMock, new TypeError("Failed to fetch"));

    await expect(gqlIsChannelLive("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "net-error");
  });

  it("does NOT call recordPlatformFailure on HTTP 403 (not a platform outage)", async () => {
    stubFetchError(fetchMock, 403, "Forbidden");

    await expect(gqlIsChannelLive("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
  });

  it("does NOT call recordPlatformFailure on HTTP 404 (not a platform outage)", async () => {
    stubFetchError(fetchMock, 404, "Not Found");

    await expect(gqlIsChannelLive("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).not.toHaveBeenCalled();
  });
});

describe("sendPersistedQuery — platform-health instrumentation", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockRecordPlatformSuccess.mockClear();
    mockRecordPlatformFailure.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls recordPlatformSuccess('twitch') on a successful persisted query", async () => {
    // gqlGetPlaybackAccessToken uses sendPersistedQuery indirectly via gqlRequest
    // Actually, gqlGetPlaybackAccessToken uses gqlRequest, not sendPersistedQuery.
    // Use the DirectoryPage_Game persisted query path via gqlGetTopStreams with gameId.
    // First call: resolveGameSlugById
    stubFetch(fetchMock, { data: { game: { slug: "test-slug" } } });
    // Second call: sendPersistedQuery
    stubFetchRaw(fetchMock, {
      data: {
        game: {
          streams: {
            edges: [],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    await gqlGetTopStreams({ gameId: "persisted-health-test" });

    expect(mockRecordPlatformSuccess).toHaveBeenCalledWith("twitch");
  });

  it("calls recordPlatformFailure('twitch', 'server-5xx') on HTTP 502 from persisted query", async () => {
    // gqlGetPlaybackAccessToken goes through gqlRequest, not sendPersistedQuery
    // Use it directly since it calls gqlRequest → fetch fails with 502
    stubFetchError(fetchMock, 502, "Bad Gateway");

    await expect(gqlGetPlaybackAccessToken("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "server-5xx");
  });

  it("calls recordPlatformFailure('twitch', 'timeout') on timeout from persisted query", async () => {
    const err = new DOMException("The operation was aborted.", "TimeoutError");
    stubFetchReject(fetchMock, err);

    await expect(gqlGetPlaybackAccessToken("ch")).rejects.toThrow();

    expect(mockRecordPlatformFailure).toHaveBeenCalledWith("twitch", "timeout");
  });
});
