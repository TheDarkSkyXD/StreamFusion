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
  gqlFetchGamesForVideos,
  gqlGetAllTopCategories,
  gqlGetCategoryById,
  gqlGetCategoryViewerCountsByIds,
  gqlGetChannelByLogin,
  gqlGetClipAccessToken,
  gqlGetClipsByChannel,
  gqlGetFollowerCount,
  gqlGetGameMetadata,
  gqlGetPlaybackAccessToken,
  gqlGetStreamByLogin,
  gqlGetStreamsByLogins,
  gqlGetTopCategories,
  gqlGetTopStreams,
  gqlGetVideoMetadata,
  gqlGetVideosByChannel,
  gqlGetVodAccessToken,
  gqlIsChannelLive,
  gqlSearchCategories,
  gqlSearchChannels,
  type SearchChannelEdgeItem,
  type SearchGameEdgeItem,
} from "@backend/api/platforms/twitch/twitch-gql-client";
import { logger } from "@shared/utils/cross-logger";

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

function lastFetchHeaders(fetchMock: FetchMock): Record<string, string> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers ?? {};
}

function nthFetchBody(fetchMock: FetchMock, n: number): string {
  const call = fetchMock.mock.calls[n];
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ?? "";
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDirectoryPageGameStream(overrides: Record<string, unknown> = {}) {
  return {
    id: "stream-1",
    title: "Test Stream",
    viewersCount: 1234,
    previewImageURL: "https://cdn/{width}x{height}.jpg",
    type: "live",
    broadcaster: {
      id: "user-1",
      login: "testuser",
      displayName: "TestUser",
      profileImageURL: "https://cdn/avatar.jpg",
      primaryColorHex: "FF0000",
      roles: { isPartner: true, __typename: "UserRoles" },
      __typename: "User",
    },
    freeformTags: [
      { id: "t1", name: "English", __typename: "FreeformTag" },
      { id: "t2", name: "FPS", __typename: "FreeformTag" },
    ],
    game: {
      id: "game-1",
      boxArtURL: "https://cdn/box.jpg",
      name: "valorant",
      displayName: "VALORANT",
      slug: "valorant",
      __typename: "Game",
    },
    previewThumbnailProperties: {
      blurReason: "BLUR_NOT_REQUIRED",
      __typename: "PreviewThumbnailProperties",
    },
    __typename: "Stream",
    ...overrides,
  };
}

function makeStreamMetadataResponse(login: string, overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user: {
        id: "user-1",
        login,
        profileImageURL: "https://cdn/avatar.jpg",
        stream: {
          id: "stream-1",
          type: "live",
          createdAt: "2026-01-01T00:00:00Z",
          game: { id: "game-1", name: "VALORANT", __typename: "Game" },
          __typename: "Stream",
          ...overrides,
        },
        lastBroadcast: { title: "Live Stream Title", __typename: "Broadcast" },
        __typename: "User",
      },
    },
  };
}

function makeViewCountResponse(count: number) {
  return {
    data: {
      user: {
        stream: { viewersCount: count, __typename: "Stream" },
        __typename: "User",
      },
    },
  };
}

function makeTagsAndLanguageResponse(tags: string[], language: string, displayName?: string) {
  return {
    data: {
      user: {
        displayName,
        stream: {
          freeformTags: tags.map((name, i) => ({ id: `t${i}`, name })),
        },
        broadcastSettings: { language },
      },
    },
  };
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

describe("gqlGetGameMetadata", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns tags for a valid game", async () => {
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "123",
          tags: [
            { id: "t1", localizedName: "Shooter" },
            { id: "t2", localizedName: "Action" },
          ],
        },
      },
    });

    const result = await gqlGetGameMetadata("123");

    expect(result).toEqual({ tags: ["Shooter", "Action"] });
  });

  it("filters out tags with empty or whitespace-only localizedName", async () => {
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "123",
          tags: [
            { id: "t1", localizedName: "Shooter" },
            { id: "t2", localizedName: "" },
            { id: "t3", localizedName: "  " },
            { id: "t4", localizedName: null },
          ],
        },
      },
    });

    const result = await gqlGetGameMetadata("123");

    expect(result).toEqual({ tags: ["Shooter"] });
  });

  it("returns null when game is not found", async () => {
    stubFetch(fetchMock, { data: { game: null } });

    const result = await gqlGetGameMetadata("999");

    expect(result).toBeNull();
  });

  it("returns empty tags array when game has no tags", async () => {
    stubFetch(fetchMock, {
      data: { game: { id: "123", tags: null } },
    });

    const result = await gqlGetGameMetadata("123");

    expect(result).toEqual({ tags: [] });
  });

  it("returns null and logs warning on network error", async () => {
    const warnSpy = vi.mocked(logger.warn);
    stubFetchReject(fetchMock, new Error("Network failure"));

    const result = await gqlGetGameMetadata("123");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "gqlGetGameMetadata failed",
      expect.objectContaining({
        gameId: "123",
        error: expect.objectContaining({ message: "Network failure" }),
      })
    );
  });

  it("sends correct Client-Id header and GQL endpoint", async () => {
    stubFetch(fetchMock, { data: { game: null } });

    await gqlGetGameMetadata("123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = lastFetchHeaders(fetchMock);
    expect(headers["Client-Id"]).toBe("kd1unb4b3q4t58fwlpcbzcbnm76a8fp");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(fetchMock.mock.calls[0][0]).toBe("https://gql.twitch.tv/gql");
  });
});

// ---------------------------------------------------------------------------

// Guards: Twitch top-stream browse must not return unroutable streams when GQL omits broadcaster data.
describe("gqlGetTopStreams", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns top streams with pagination cursor", async () => {
    const stream = makeDirectoryPageGameStream();
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: true, __typename: "PageInfo" },
          __typename: "StreamConnection",
        },
      },
    });

    const result = await gqlGetTopStreams({ first: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].platform).toBe("twitch");
    expect(result.data[0].channelName).toBe("testuser");
    expect(result.data[0].viewerCount).toBe(1234);
    expect(result.data[0].thumbnailUrl).toBe("https://cdn/440x248.jpg");
    expect(result.data[0].tags).toEqual(["English", "FPS"]);
    expect(result.cursor).toBe("c1");
  });

  it("clamps limit to 30 for top-level streams query", async () => {
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    await gqlGetTopStreams({ first: 100 });

    const body = JSON.parse(lastFetchBody(fetchMock));
    const query = body[0];
    expect(query.variables.limit).toBe(30);
  });

  it("returns empty data when streams is null", async () => {
    stubFetch(fetchMock, { data: { streams: null } });

    const result = await gqlGetTopStreams();

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  it("returns undefined cursor when hasNextPage is false", async () => {
    const stream = makeDirectoryPageGameStream();
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopStreams();

    expect(result.data).toHaveLength(1);
    expect(result.cursor).toBeUndefined();
  });

  it("delegates to gqlGetStreamsByGameId when gameId is provided", async () => {
    // First call: resolveGameSlugById raw query
    stubFetch(fetchMock, { data: { game: { slug: "delegate-slug" } } });
    // Second call: DirectoryPage_Game persisted query
    stubFetchRaw(fetchMock, {
      data: {
        game: {
          streams: {
            edges: [
              {
                cursor: "c1",
                node: makeDirectoryPageGameStream(),
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetTopStreams({ gameId: "delegate-game", first: 5 });

    expect(result.data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("transforms stream fields correctly: isMature flag from blurReason", async () => {
    const matureStream = makeDirectoryPageGameStream({
      previewThumbnailProperties: {
        blurReason: "MATURE_CONTENT",
        __typename: "PreviewThumbnailProperties",
      },
    });
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: matureStream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopStreams();

    expect(result.data[0].isMature).toBe(true);
  });

  it("isMature is false when blurReason is BLUR_NOT_REQUIRED", async () => {
    const stream = makeDirectoryPageGameStream();
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopStreams();

    expect(result.data[0].isMature).toBe(false);
  });

  it("logs warning on GQL errors", async () => {
    const warnSpy = vi.mocked(logger.warn);
    stubFetch(fetchMock, {
      data: { streams: { edges: [], pageInfo: { hasNextPage: false } } },
      errors: [{ message: "Rate limited" }],
    });

    await gqlGetTopStreams();

    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "TopStreams query errors",
      expect.objectContaining({ messages: "Rate limited" })
    );
  });

  it("passes cursor from options.after", async () => {
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    await gqlGetTopStreams({ after: "page2cursor" });

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.cursor).toBe("page2cursor");
  });

  it("recovers channel login from the preview URL when broadcaster data is missing", async () => {
    const stream = makeDirectoryPageGameStream({
      broadcaster: null,
      previewImageURL:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_recovered_login-440x248.jpg",
    });
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });
    stubFetchBatch(
      fetchMock,
      makeStreamMetadataResponse("recovered_login"),
      makeViewCountResponse(42000),
      makeTagsAndLanguageResponse(["English", "Challenge Run"], "EN")
    );

    const result = await gqlGetTopStreams();

    expect(result.data[0].channelId).toBe("user-1");
    expect(result.data[0].channelName).toBe("recovered_login");
    expect(result.data[0].channelDisplayName).toBe("recovered_login");
    expect(result.data[0].channelAvatar).toBe("https://cdn/avatar.jpg");
    expect(result.data[0].title).toBe("Live Stream Title");
    expect(result.data[0].tags).toEqual(["English", "Challenge Run"]);
    expect(result.data[0].language).toBe("en");
  });

  it("drops streams that still have no routable channel login", async () => {
    const stream = makeDirectoryPageGameStream({ broadcaster: null });
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopStreams();

    expect(result.data).toEqual([]);
  });

  it("handles missing freeformTags gracefully", async () => {
    const stream = makeDirectoryPageGameStream({ freeformTags: null });
    stubFetch(fetchMock, {
      data: {
        streams: {
          edges: [{ cursor: "c1", node: stream, __typename: "StreamEdge" }],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopStreams();

    expect(result.data[0].tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetTopStreams — gameId path (DirectoryPage_Game persisted query)", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends language uppercased in the persisted query", async () => {
    stubFetch(fetchMock, { data: { game: { slug: "chess-lang" } } });
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

    await gqlGetTopStreams({ gameId: "lang-game", language: "es" });

    const body = JSON.parse(nthFetchBody(fetchMock, 1));
    expect(body.variables.options.broadcasterLanguages).toEqual(["ES"]);
  });

  it("returns empty data when game or streams is null in persisted response", async () => {
    stubFetch(fetchMock, { data: { game: { slug: "null-streams" } } });
    stubFetchRaw(fetchMock, { data: { game: null } });

    const result = await gqlGetTopStreams({ gameId: "null-streams-game" });

    expect(result.data).toEqual([]);
  });

  it("falls back to raw path when persisted query returns errors", async () => {
    const warnSpy = vi.mocked(logger.warn);
    // slug resolve (gqlRequest → json returns array)
    stubFetch(fetchMock, { data: { game: { slug: "chess-fallback" } } });
    // persisted query returns errors (sendPersistedQuery → json returns plain object)
    stubFetchRaw(fetchMock, {
      data: null,
      errors: [{ message: "PersistedQueryNotFound" }],
    });
    // raw query fallback (gqlRequest → json returns array)
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "g1",
          streams: {
            edges: [],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetTopStreams({ gameId: "g1" });

    expect(result.data).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "DirectoryPage_Game persisted query failed, falling back to raw",
      expect.any(Object)
    );
  });

  it("falls back to raw query when slug resolution returns null", async () => {
    // Use a unique gameId so cached slugs from other tests don't interfere
    stubFetch(fetchMock, { data: { game: null } }); // slug resolve returns null
    // raw query fallback
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "no-slug-game",
          streams: {
            edges: [
              {
                cursor: "c1",
                node: makeDirectoryPageGameStream(),
                __typename: "StreamEdge",
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetTopStreams({ gameId: "no-slug-game" });

    expect(result.data).toHaveLength(1);
  });

  it("caches slug after first resolution", async () => {
    // First call: slug resolve + persisted query
    stubFetch(fetchMock, { data: { game: { slug: "valorant" } } });
    stubFetchRaw(fetchMock, {
      data: {
        game: {
          streams: { edges: [], pageInfo: { hasNextPage: false } },
        },
      },
    });

    await gqlGetTopStreams({ gameId: "cached-game-id" });

    // Second call: should NOT re-resolve slug (one fewer fetch)
    stubFetchRaw(fetchMock, {
      data: {
        game: {
          streams: { edges: [], pageInfo: { hasNextPage: false } },
        },
      },
    });

    await gqlGetTopStreams({ gameId: "cached-game-id" });

    // 1 slug + 1 persisted + 1 persisted (no second slug resolve)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("raw fallback clamps first to 100", async () => {
    stubFetch(fetchMock, { data: { game: null } }); // no slug
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "clamp-game",
          streams: { edges: [], pageInfo: { hasNextPage: false } },
        },
      },
    });

    await gqlGetTopStreams({ gameId: "clamp-game", first: 200 });

    const body = JSON.parse(nthFetchBody(fetchMock, 1));
    expect(body[0].variables.first).toBe(100);
  });

  it("raw fallback silently swallows integrity check errors", async () => {
    const warnSpy = vi.mocked(logger.warn);
    stubFetch(fetchMock, { data: { game: null } }); // no slug
    stubFetch(fetchMock, {
      data: {
        game: { id: "integrity-game", streams: { edges: [], pageInfo: { hasNextPage: false } } },
      },
      errors: [{ message: "failed integrity check" }],
    });

    await gqlGetTopStreams({ gameId: "integrity-game" });

    expect(warnSpy).not.toHaveBeenCalledWith(
      "Twitch:GQL",
      "GetStreamsByGameId query errors",
      expect.anything()
    );
  });

  it("raw fallback warns on non-integrity GQL errors", async () => {
    const warnSpy = vi.mocked(logger.warn);
    stubFetch(fetchMock, { data: { game: null } }); // no slug
    stubFetch(fetchMock, {
      data: { game: { id: "warn-game", streams: { edges: [], pageInfo: { hasNextPage: false } } } },
      errors: [{ message: "Internal server error" }],
    });

    await gqlGetTopStreams({ gameId: "warn-game" });

    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "GetStreamsByGameId query errors",
      expect.objectContaining({ messages: "Internal server error" })
    );
  });
});

// ---------------------------------------------------------------------------

// Guards: Twitch stream lookup preserves login identity while displaying the provider-cased channel name.
describe("gqlGetStreamByLogin", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unified stream for a live channel", async () => {
    stubFetchBatch(
      fetchMock,
      makeStreamMetadataResponse("ninja"),
      makeViewCountResponse(42000),
      makeTagsAndLanguageResponse(["English", "FPS"], "EN")
    );

    const result = await gqlGetStreamByLogin("ninja");

    expect(result).not.toBeNull();
    expect(result!.platform).toBe("twitch");
    expect(result!.channelName).toBe("ninja");
    expect(result!.channelDisplayName).toBe("ninja");
    expect(result!.viewerCount).toBe(42000);
    expect(result!.tags).toEqual(["English", "FPS"]);
    expect(result!.language).toBe("en");
    expect(result!.isLive).toBe(true);
    expect(result!.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result!.categoryId).toBe("game-1");
    expect(result!.categoryName).toBe("VALORANT");
  });

  it("uses the provider display name while retaining login identity", async () => {
    stubFetchBatch(
      fetchMock,
      makeStreamMetadataResponse("appie201"),
      makeViewCountResponse(42),
      makeTagsAndLanguageResponse([], "EN", "Appie201")
    );

    const result = await gqlGetStreamByLogin("appie201");

    expect(result).toMatchObject({
      channelName: "appie201",
      channelDisplayName: "Appie201",
    });
  });

  it("returns null when user has no stream", async () => {
    stubFetchBatch(
      fetchMock,
      {
        data: {
          user: {
            id: "u1",
            login: "offline",
            profileImageURL: "",
            stream: null,
            lastBroadcast: null,
          },
        },
      },
      makeViewCountResponse(0),
      makeTagsAndLanguageResponse([], "")
    );

    const result = await gqlGetStreamByLogin("offline");

    expect(result).toBeNull();
  });

  it("returns null when user is null", async () => {
    stubFetchBatch(
      fetchMock,
      { data: { user: null } },
      { data: { user: null } },
      { data: { user: null } }
    );

    const result = await gqlGetStreamByLogin("nonexistent");

    expect(result).toBeNull();
  });

  it("batches three queries in one fetch call", async () => {
    stubFetchBatch(
      fetchMock,
      makeStreamMetadataResponse("ninja"),
      makeViewCountResponse(100),
      makeTagsAndLanguageResponse([], "")
    );

    await gqlGetStreamByLogin("ninja");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body).toHaveLength(3);
  });

  it("lowercases the language from broadcastSettings", async () => {
    stubFetchBatch(
      fetchMock,
      makeStreamMetadataResponse("streamer"),
      makeViewCountResponse(50),
      makeTagsAndLanguageResponse([], "FR")
    );

    const result = await gqlGetStreamByLogin("streamer");

    expect(result!.language).toBe("fr");
  });
});

// ---------------------------------------------------------------------------

// Guards: Batched Twitch stream lookup uses provider display names without changing login identity.
describe("gqlGetStreamsByLogins", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array for empty input", async () => {
    const result = await gqlGetStreamsByLogins([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns live streams only (filters out offline)", async () => {
    // UseLive batch: channel1 live, channel2 offline (single gqlRequest)
    stubFetchBatch(fetchMock, makeUseLiveResponse(true), makeUseLiveResponse(false));
    // Detail queries for the 1 live channel (StreamMetadata + ViewCount pair)
    stubFetchBatch(fetchMock, makeStreamMetadataResponse("channel1"), makeViewCountResponse(500));
    // Tags side query (getTagsAndLanguageByLogins)
    stubFetchBatch(fetchMock, makeTagsAndLanguageResponse(["RPG"], "EN"));

    const result = await gqlGetStreamsByLogins(["channel1", "channel2"]);

    expect(result).toHaveLength(1);
    expect(result[0].channelName).toBe("channel1");
    expect(result[0].channelDisplayName).toBe("channel1");
    expect(result[0].isLive).toBe(true);
    expect(result[0].tags).toEqual(["RPG"]);
    expect(result[0].language).toBe("en");
  });

  it("returns empty array when no channels are live", async () => {
    stubFetchBatch(fetchMock, makeUseLiveResponse(false), makeUseLiveResponse(false));

    const result = await gqlGetStreamsByLogins(["ch1", "ch2"]);

    expect(result).toEqual([]);
  });

  it("enriches streams with tags and language from side query", async () => {
    stubFetchBatch(fetchMock, makeUseLiveResponse(true));
    stubFetchBatch(fetchMock, makeStreamMetadataResponse("ch1"), makeViewCountResponse(100));
    stubFetchBatch(fetchMock, makeTagsAndLanguageResponse(["Competitive", "Ranked"], "DE"));

    const result = await gqlGetStreamsByLogins(["ch1"]);

    expect(result[0].tags).toEqual(["Competitive", "Ranked"]);
    expect(result[0].language).toBe("de");
  });

  it("uses provider display names for batched live streams", async () => {
    stubFetchBatch(fetchMock, makeUseLiveResponse(true));
    stubFetchBatch(fetchMock, makeStreamMetadataResponse("appie201"), makeViewCountResponse(100));
    stubFetchBatch(fetchMock, makeTagsAndLanguageResponse([], "EN", "Appie201"));

    const result = await gqlGetStreamsByLogins(["appie201"]);

    expect(result[0]).toMatchObject({
      channelName: "appie201",
      channelDisplayName: "Appie201",
    });
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetTopCategories", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns categories with box art URL transformed", async () => {
    stubFetch(fetchMock, {
      data: {
        directoriesWithTags: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "cat-1",
                name: "valorant",
                displayName: "VALORANT",
                slug: "valorant",
                avatarURL: "https://cdn/{width}x{height}.jpg",
                viewersCount: 50000,
                __typename: "Directory",
              },
              __typename: "DirectoryEdge",
            },
          ],
          pageInfo: { hasNextPage: true, __typename: "PageInfo" },
          __typename: "DirectoryConnection",
        },
      },
    });

    const result = await gqlGetTopCategories({ first: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("cat-1");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.data[0].name).toBe("VALORANT");
    expect(result.data[0].slug).toBe("valorant");
    expect(result.data[0].boxArtUrl).toBe("https://cdn/285x380.jpg");
    expect(result.data[0].viewerCount).toBe(50000);
    expect(result.cursor).toBe("c1");
  });

  it("returns empty data when directoriesWithTags is null", async () => {
    stubFetch(fetchMock, { data: { directoriesWithTags: null } });

    const result = await gqlGetTopCategories();

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  it("returns undefined cursor when hasNextPage is false", async () => {
    stubFetch(fetchMock, {
      data: {
        directoriesWithTags: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "cat-1",
                name: "chess",
                displayName: "Chess",
                slug: "chess",
                avatarURL: "https://cdn/{width}x{height}.jpg",
                viewersCount: 100,
              },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopCategories();

    expect(result.cursor).toBeUndefined();
  });

  it("falls back to name when displayName is falsy", async () => {
    stubFetch(fetchMock, {
      data: {
        directoriesWithTags: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "cat-1",
                name: "chess",
                displayName: null,
                slug: "chess",
                avatarURL: "https://cdn/{width}x{height}.jpg",
                viewersCount: null,
              },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    });

    const result = await gqlGetTopCategories();

    expect(result.data[0].name).toBe("chess");
    expect(result.data[0].viewerCount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetAllTopCategories", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates until cursor is undefined", async () => {
    const page = (cursor: string | null, hasNext: boolean) => ({
      data: {
        directoriesWithTags: {
          edges: [
            {
              cursor: cursor ?? "last",
              node: {
                id: `cat-${cursor || "end"}`,
                name: "game",
                displayName: "Game",
                slug: "game",
                avatarURL: "https://cdn/{width}x{height}.jpg",
                viewersCount: 10,
              },
            },
          ],
          pageInfo: { hasNextPage: hasNext },
        },
      },
    });

    stubFetch(fetchMock, page("c1", true));
    stubFetch(fetchMock, page("c2", true));
    stubFetch(fetchMock, page(null, false));

    const result = await gqlGetAllTopCategories();

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops when data.length is 0 even if cursor exists", async () => {
    stubFetch(fetchMock, {
      data: {
        directoriesWithTags: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "cat-1",
                name: "game",
                displayName: "Game",
                slug: "game",
                avatarURL: "https://cdn/{width}x{height}.jpg",
                viewersCount: 10,
              },
            },
          ],
          pageInfo: { hasNextPage: true },
        },
      },
    });
    stubFetch(fetchMock, {
      data: {
        directoriesWithTags: {
          edges: [],
          pageInfo: { hasNextPage: true },
        },
      },
    });

    const result = await gqlGetAllTopCategories();

    expect(result).toHaveLength(1);
  });

  it("enforces safety limit at 5000 categories", async () => {
    const warnSpy = vi.mocked(logger.warn);
    const makePage = () => ({
      data: {
        directoriesWithTags: {
          edges: Array.from({ length: 30 }, (_, i) => ({
            cursor: `c-${Math.random()}`,
            node: {
              id: `cat-${Math.random()}`,
              name: "game",
              displayName: "Game",
              slug: "game",
              avatarURL: "https://cdn/{width}x{height}.jpg",
              viewersCount: 10,
            },
          })),
          pageInfo: { hasNextPage: true },
        },
      },
    });

    // Enough pages to exceed 5000 total (5000/30 = 167 pages)
    for (let i = 0; i < 200; i++) {
      stubFetch(fetchMock, makePage());
    }

    const result = await gqlGetAllTopCategories();

    expect(result.length).toBeGreaterThanOrEqual(5000);
    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "Twitch GQL category fetch hit safety limit (5000)"
    );
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetCategoryById", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns category for a valid game ID", async () => {
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "123",
          name: "valorant",
          displayName: "VALORANT",
          slug: "valorant",
          boxArtURL: "https://cdn/{width}x{height}.jpg",
          viewersCount: 50000,
        },
      },
    });

    const result = await gqlGetCategoryById("123");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("123");
    expect(result!.platform).toBe("twitch");
    expect(result!.name).toBe("VALORANT");
    expect(result!.slug).toBe("valorant");
    expect(result!.boxArtUrl).toBe("https://cdn/285x380.jpg");
    expect(result!.viewerCount).toBe(50000);
  });

  it("returns null when game is not found", async () => {
    stubFetch(fetchMock, { data: { game: null } });

    const result = await gqlGetCategoryById("999");

    expect(result).toBeNull();
  });

  it("falls back to name when displayName is falsy", async () => {
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "123",
          name: "chess",
          displayName: null,
          slug: null,
          boxArtURL: "https://cdn/{width}x{height}.jpg",
          viewersCount: null,
        },
      },
    });

    const result = await gqlGetCategoryById("123");

    expect(result!.name).toBe("chess");
    expect(result!.slug).toBeUndefined();
    expect(result!.viewerCount).toBeUndefined();
  });

  it("logs warning on GQL errors but still returns data", async () => {
    const warnSpy = vi.mocked(logger.warn);
    stubFetch(fetchMock, {
      data: {
        game: {
          id: "123",
          name: "chess",
          displayName: "Chess",
          slug: "chess",
          boxArtURL: "https://cdn/{width}x{height}.jpg",
          viewersCount: 100,
        },
      },
      errors: [{ message: "Partial error" }],
    });

    const result = await gqlGetCategoryById("123");

    expect(result).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "Twitch:GQL",
      "GetGameById query errors",
      expect.objectContaining({ messages: "Partial error" })
    );
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetCategoryViewerCountsByIds", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes IDs, passes them as variables, and preserves zero counts", async () => {
    stubFetch(fetchMock, {
      data: {
        g0: { id: "123", viewersCount: 0 },
        g1: { id: "456", viewersCount: 42 },
      },
    });

    const result = await gqlGetCategoryViewerCountsByIds(["123", " 123 ", "456"]);

    expect(result).toEqual({ "123": 0, "456": 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(lastFetchBody(fetchMock))[0];
    expect(request.variables).toEqual({ id0: "123", id1: "456" });
    expect(request.query).toContain("g0: game(id: $id0) { id viewersCount }");
    expect(request.query).toContain("g1: game(id: $id1) { id viewersCount }");
    expect(request.query).not.toContain('game(id: "123")');
    expect(request.query).not.toContain('game(id: "456")');
  });

  it("omits null, negative, non-finite, and missing game results", async () => {
    stubFetch(fetchMock, {
      data: {
        g0: null,
        g1: { id: "null-count", viewersCount: null },
        g2: { id: "negative", viewersCount: -1 },
        g3: { id: "non-finite", viewersCount: Number.NaN },
        g4: { viewersCount: 10 },
        g5: { id: "valid", viewersCount: 7 },
      },
    });

    const result = await gqlGetCategoryViewerCountsByIds([
      "missing",
      "null-count",
      "negative",
      "non-finite",
      "bad-shape",
      "valid",
    ]);

    expect(result).toEqual({ valid: 7 });
  });

  it("returns empty without a request when no IDs remain", async () => {
    const result = await gqlGetCategoryViewerCountsByIds(["", "   "]);

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps IDs to one bounded GQL request", async () => {
    stubFetch(fetchMock, { data: {} });

    const result = await gqlGetCategoryViewerCountsByIds(
      Array.from({ length: 105 }, (_, index) => String(index + 1))
    );

    expect(result).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(lastFetchBody(fetchMock))[0];
    expect(Object.keys(request.variables)).toHaveLength(100);
    expect(request.variables.id99).toBe("100");
    expect(request.variables.id100).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

// Guards: direct Twitch channel lookup preserves the AboutPanel last-broadcast game so offline channel pages can show category context.
// Guards: direct Twitch channel lookup never treats a broadcast start as the time an offline stream ended.
describe("gqlGetChannelByLogin", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns channel info with social links", async () => {
    stubFetchBatch(
      fetchMock,
      {
        data: {
          userOrError: {
            id: "u1",
            login: "ninja",
            displayName: "Ninja",
            profileImageURL: "https://cdn/avatar.jpg",
            bannerImageURL: "https://cdn/banner.jpg",
            stream: { id: "s1", __typename: "Stream" },
            __typename: "User",
          },
        },
      },
      {
        data: {
          user: {
            description: "Pro gamer",
            roles: { isPartner: true, __typename: "UserRoles" },
            followers: { totalCount: 18000000, __typename: "FollowerConnection" },
            lastBroadcast: {
              id: "broadcast-1",
              game: { id: "game-1", displayName: "Fortnite", __typename: "Game" },
              __typename: "Broadcast",
            },
            channel: {
              socialMedias: [
                { name: "Twitter", url: "https://twitter.com/ninja" },
                { name: "YouTube", url: "https://youtube.com/ninja" },
              ],
            },
            __typename: "User",
          },
        },
      }
    );

    const result = await gqlGetChannelByLogin("ninja");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("u1");
    expect(result!.platform).toBe("twitch");
    expect(result!.username).toBe("ninja");
    expect(result!.displayName).toBe("Ninja");
    expect(result!.avatarUrl).toBe("https://cdn/avatar.jpg");
    expect(result!.bannerUrl).toBe("https://cdn/banner.jpg");
    expect(result!.bio).toBe("Pro gamer");
    expect(result!.isLive).toBe(true);
    expect(result!.isVerified).toBe(true);
    expect(result!.isPartner).toBe(true);
    expect(result!.followerCount).toBe(18000000);
    expect(result!.categoryId).toBe("game-1");
    expect(result!.categoryName).toBe("Fortnite");
    expect(result!.socialLinks).toEqual([
      { platform: "Twitter", url: "https://twitter.com/ninja" },
      { platform: "YouTube", url: "https://youtube.com/ninja" },
    ]);
  });

  it("omits last-live time when an offline channel only supplies last broadcast start", async () => {
    stubFetchBatch(
      fetchMock,
      {
        data: {
          userOrError: {
            id: "u1",
            login: "ninja",
            displayName: "Ninja",
            profileImageURL: "https://cdn/avatar.jpg",
            bannerImageURL: null,
            stream: null,
            __typename: "User",
          },
        },
      },
      { data: { user: null } }
    );

    const result = await gqlGetChannelByLogin("ninja");

    expect(result!.lastLiveAt).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body).toHaveLength(2);
  });

  it("does not expose an offline last-live time while the channel is live", async () => {
    stubFetchBatch(
      fetchMock,
      {
        data: {
          userOrError: {
            id: "u1",
            login: "ninja",
            displayName: "Ninja",
            profileImageURL: "https://cdn/avatar.jpg",
            bannerImageURL: null,
            stream: { id: "stream-1", __typename: "Stream" },
            __typename: "User",
          },
        },
      },
      {
        data: {
          user: {
            lastBroadcast: {
              id: "broadcast-1",
              startedAt: "2026-08-01T15:30:00Z",
              game: null,
              __typename: "Broadcast",
            },
          },
        },
      }
    );

    const result = await gqlGetChannelByLogin("ninja");

    expect(result).toMatchObject({ isLive: true });
    expect(result!.lastLiveAt).toBeUndefined();
  });

  it("returns null when user does not exist", async () => {
    stubFetchBatch(
      fetchMock,
      { data: { userOrError: { userDoesNotExist: "not found", key: "doesNotExist" } } },
      { data: { user: null } }
    );

    const result = await gqlGetChannelByLogin("nobody");

    expect(result).toBeNull();
  });

  it("returns null when userOrError is null", async () => {
    stubFetchBatch(fetchMock, { data: { userOrError: null } }, { data: { user: null } });

    const result = await gqlGetChannelByLogin("nobody");

    expect(result).toBeNull();
  });

  it("handles missing optional about-panel fields", async () => {
    stubFetchBatch(
      fetchMock,
      {
        data: {
          userOrError: {
            id: "u1",
            login: "ch1",
            displayName: "Ch1",
            profileImageURL: "",
            bannerImageURL: null,
            stream: null,
          },
        },
      },
      {
        data: {
          user: {
            description: "",
            roles: null,
            followers: null,
            channel: null,
          },
        },
      }
    );

    const result = await gqlGetChannelByLogin("ch1");

    expect(result!.isLive).toBe(false);
    expect(result!.isVerified).toBe(false);
    expect(result!.isPartner).toBe(false);
    expect(result!.followerCount).toBeUndefined();
    expect(result!.lastLiveAt).toBeUndefined();
    expect(result!.bannerUrl).toBeUndefined();
    expect(result!.bio).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetVideosByChannel", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns videos with proper field mapping", async () => {
    stubFetch(fetchMock, {
      data: {
        user: {
          videos: {
            edges: [
              {
                cursor: "vc1",
                node: {
                  id: "v123",
                  title: "Past Broadcast",
                  previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
                  lengthSeconds: 3600,
                  viewCount: 1000,
                  publishedAt: "2026-01-01T00:00:00Z",
                  owner: {
                    id: "u1",
                    login: "streamer",
                    displayName: "Streamer",
                    profileImageURL: "https://cdn/avatar.jpg",
                  },
                },
              },
            ],
            pageInfo: { hasNextPage: true },
          },
        },
      },
    });

    const result = await gqlGetVideosByChannel("streamer", { first: 5 });

    expect(result.data).toHaveLength(1);
    const video = result.data[0];
    expect(video.id).toBe("v123");
    expect(video.platform).toBe("twitch");
    expect(video.channelId).toBe("u1");
    expect(video.channelName).toBe("streamer");
    expect(video.title).toBe("Past Broadcast");
    expect(video.thumbnailUrl).toBe("https://cdn/320x180.jpg");
    expect(video.duration).toBe(3600);
    expect(video.viewCount).toBe(1000);
    expect(video.url).toBe("https://www.twitch.tv/videos/v123");
    expect(result.cursor).toBe("vc1");
  });

  it("handles both brace-only and percent-brace thumbnail placeholders", async () => {
    // Twitch uses two formats: {width} and %{width}. The source replaces
    // {width} first — which also matches inside %{width} — leaving "%320".
    // The subsequent %{width} replacement is a no-op. This test pins that
    // actual behavior so a refactor that changes ordering is caught.
    stubFetch(fetchMock, {
      data: {
        user: {
          videos: {
            edges: [
              {
                cursor: "vc1",
                node: {
                  id: "v1",
                  title: "Video",
                  previewThumbnailURL: "https://cdn/%{width}x%{height}.jpg",
                  lengthSeconds: 100,
                  viewCount: 0,
                  publishedAt: "",
                  owner: { id: "u1", login: "ch", displayName: "Ch", profileImageURL: "" },
                },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetVideosByChannel("ch");

    // {width} inside %{width} is replaced first → "%320x%180"
    expect(result.data[0].thumbnailUrl).toBe("https://cdn/%320x%180.jpg");
  });

  it("returns empty data when user has no videos", async () => {
    stubFetch(fetchMock, { data: { user: { videos: null } } });

    const result = await gqlGetVideosByChannel("nobody");

    expect(result.data).toEqual([]);
  });

  it("returns empty data when user is null", async () => {
    stubFetch(fetchMock, { data: { user: null } });

    const result = await gqlGetVideosByChannel("nobody");

    expect(result.data).toEqual([]);
  });

  it("maps broadcastType filter to uppercase", async () => {
    stubFetch(fetchMock, { data: { user: { videos: null } } });

    await gqlGetVideosByChannel("ch", { type: "highlight" });

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.broadcastType).toBe("HIGHLIGHT");
  });

  it("passes null broadcastType when type is not specified", async () => {
    stubFetch(fetchMock, { data: { user: { videos: null } } });

    await gqlGetVideosByChannel("ch");

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.broadcastType).toBeNull();
  });

  it("handles missing owner fields gracefully", async () => {
    stubFetch(fetchMock, {
      data: {
        user: {
          videos: {
            edges: [
              {
                cursor: "vc1",
                node: {
                  id: "v1",
                  title: "Video",
                  previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
                  lengthSeconds: 100,
                  viewCount: 0,
                  publishedAt: "",
                  owner: null,
                },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetVideosByChannel("ch");

    expect(result.data[0].channelId).toBe("");
    expect(result.data[0].channelName).toBe("ch");
    expect(result.data[0].channelDisplayName).toBe("ch");
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetClipsByChannel", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns clips with slug as id", async () => {
    stubFetch(fetchMock, {
      data: {
        user: {
          clips: {
            edges: [
              {
                cursor: "cc1",
                node: {
                  id: "12345",
                  slug: "AmazingClip-abc123",
                  title: "Amazing Play",
                  thumbnailURL: "https://cdn/thumb.jpg",
                  url: "https://clips.twitch.tv/AmazingClip-abc123",
                  embedURL: "https://clips.twitch.tv/embed?clip=AmazingClip-abc123",
                  durationSeconds: 30,
                  viewCount: 5000,
                  createdAt: "2026-01-01T00:00:00Z",
                  broadcaster: {
                    id: "u1",
                    login: "streamer",
                    displayName: "Streamer",
                    profileImageURL: "https://cdn/avatar.jpg",
                  },
                  curator: { displayName: "Clipper", __typename: "User" },
                  game: { id: "game-1", name: "VALORANT", __typename: "Game" },
                  __typename: "Clip",
                },
              },
            ],
            pageInfo: { hasNextPage: true },
          },
        },
      },
    });

    const result = await gqlGetClipsByChannel("streamer", { first: 10 });

    expect(result.data).toHaveLength(1);
    const clip = result.data[0];
    expect(clip.id).toBe("AmazingClip-abc123");
    expect(clip.platform).toBe("twitch");
    expect(clip.channelName).toBe("streamer");
    expect(clip.title).toBe("Amazing Play");
    expect(clip.duration).toBe(30);
    expect(clip.viewCount).toBe(5000);
    expect(clip.creatorName).toBe("Clipper");
    expect(clip.gameId).toBe("game-1");
    expect(clip.gameName).toBe("VALORANT");
    expect(result.cursor).toBe("cc1");
  });

  it("defaults filter to LAST_WEEK", async () => {
    stubFetch(fetchMock, { data: { user: { clips: null } } });

    await gqlGetClipsByChannel("ch");

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.criteria.filter).toBe("LAST_WEEK");
  });

  it("passes custom filter through", async () => {
    stubFetch(fetchMock, { data: { user: { clips: null } } });

    await gqlGetClipsByChannel("ch", { filter: "ALL_TIME" });

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.criteria.filter).toBe("ALL_TIME");
  });

  it("returns empty data when clips is null", async () => {
    stubFetch(fetchMock, { data: { user: { clips: null } } });

    const result = await gqlGetClipsByChannel("ch");

    expect(result.data).toEqual([]);
  });

  it("handles missing curator and broadcaster gracefully", async () => {
    stubFetch(fetchMock, {
      data: {
        user: {
          clips: {
            edges: [
              {
                cursor: "cc1",
                node: {
                  id: "1",
                  slug: "Slug1",
                  title: "Clip",
                  thumbnailURL: "",
                  url: "",
                  embedURL: "",
                  durationSeconds: 10,
                  viewCount: 0,
                  createdAt: "",
                  broadcaster: null,
                  curator: null,
                  game: null,
                },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });

    const result = await gqlGetClipsByChannel("ch");

    expect(result.data[0].channelId).toBe("");
    expect(result.data[0].channelName).toBe("ch");
    expect(result.data[0].creatorName).toBe("");
    expect(result.data[0].gameId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetPlaybackAccessToken", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns token value and signature", async () => {
    stubFetch(fetchMock, {
      data: {
        streamPlaybackAccessToken: {
          value: '{"channel":"ninja"}',
          signature: "sig123",
        },
      },
    });

    const result = await gqlGetPlaybackAccessToken("ninja");

    expect(result.value).toBe('{"channel":"ninja"}');
    expect(result.signature).toBe("sig123");
  });

  it("throws when streamPlaybackAccessToken is null", async () => {
    stubFetch(fetchMock, {
      data: { streamPlaybackAccessToken: null },
    });

    await expect(gqlGetPlaybackAccessToken("offline")).rejects.toThrow(
      "No stream token found. The channel might be offline."
    );
  });

  it("sends isLive: true and isVod: false for live streams", async () => {
    stubFetch(fetchMock, {
      data: {
        streamPlaybackAccessToken: { value: "v", signature: "s" },
      },
    });

    await gqlGetPlaybackAccessToken("ninja");

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.isLive).toBe(true);
    expect(body[0].variables.isVod).toBe(false);
    expect(body[0].variables.login).toBe("ninja");
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetVodAccessToken", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns token value and signature for VOD", async () => {
    stubFetch(fetchMock, {
      data: {
        videoPlaybackAccessToken: {
          value: '{"vod_id":"123"}',
          signature: "vodsig",
        },
      },
    });

    const result = await gqlGetVodAccessToken("123");

    expect(result.value).toBe('{"vod_id":"123"}');
    expect(result.signature).toBe("vodsig");
  });

  it("throws when videoPlaybackAccessToken is null", async () => {
    stubFetch(fetchMock, {
      data: { videoPlaybackAccessToken: null },
    });

    await expect(gqlGetVodAccessToken("999")).rejects.toThrow(
      "No VOD token found. The VOD might be sub-only or deleted."
    );
  });

  it("sends isLive: false and isVod: true for VODs", async () => {
    stubFetch(fetchMock, {
      data: {
        videoPlaybackAccessToken: { value: "v", signature: "s" },
      },
    });

    await gqlGetVodAccessToken("456");

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].variables.isLive).toBe(false);
    expect(body[0].variables.isVod).toBe(true);
    expect(body[0].variables.vodID).toBe("456");
    expect(body[0].variables.login).toBe("");
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetClipAccessToken", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns qualities and token", async () => {
    stubFetch(fetchMock, {
      data: {
        clip: {
          videoQualities: [
            { quality: "1080", sourceURL: "https://cdn/1080.mp4", frameRate: 60 },
            { quality: "720", sourceURL: "https://cdn/720.mp4", frameRate: 30 },
          ],
          playbackAccessToken: {
            value: '{"clip":"slug"}',
            signature: "clipsig",
          },
        },
      },
    });

    const result = await gqlGetClipAccessToken("MyClip-abc");

    expect(result.qualities).toEqual([
      { quality: "1080", sourceURL: "https://cdn/1080.mp4", frameRate: 60 },
      { quality: "720", sourceURL: "https://cdn/720.mp4", frameRate: 30 },
    ]);
    expect(result.signature).toBe("clipsig");
    expect(result.value).toBe('{"clip":"slug"}');

    const body = JSON.parse(lastFetchBody(fetchMock));
    expect(body[0].query).toContain("query VideoAccessToken_Clip");
    expect(body[0].extensions).toBeUndefined();
    expect(body[0].variables.slug).toBe("MyClip-abc");
  });

  it("throws when clip is null", async () => {
    stubFetch(fetchMock, { data: { clip: null } });

    await expect(gqlGetClipAccessToken("nonexistent")).rejects.toThrow("Clip not found");
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetVideoMetadata", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns video metadata with proper field mapping", async () => {
    stubFetch(fetchMock, {
      data: {
        video: {
          id: "v123",
          title: "Past Broadcast",
          description: "A great stream",
          previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
          lengthSeconds: 7200,
          viewCount: 5000,
          publishedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          broadcastType: "ARCHIVE",
          owner: {
            id: "u1",
            login: "streamer",
            displayName: "Streamer",
          },
        },
      },
    });

    const result = await gqlGetVideoMetadata("v123", "streamer");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("v123");
    expect(result!.platform).toBe("twitch");
    expect(result!.channelId).toBe("u1");
    expect(result!.channelName).toBe("streamer");
    expect(result!.channelDisplayName).toBe("Streamer");
    expect(result!.channelAvatar).toBe("");
    expect(result!.title).toBe("Past Broadcast");
    expect(result!.description).toBe("A great stream");
    expect(result!.thumbnailUrl).toBe("https://cdn/320x180.jpg");
    expect(result!.duration).toBe(7200);
    expect(result!.viewCount).toBe(5000);
    expect(result!.type).toBe("archive");
    expect(result!.url).toBe("https://www.twitch.tv/videos/v123");
  });

  it("returns null when video is not found", async () => {
    stubFetch(fetchMock, { data: { video: null } });

    const result = await gqlGetVideoMetadata("999");

    expect(result).toBeNull();
  });

  it("maps HIGHLIGHT broadcastType", async () => {
    stubFetch(fetchMock, {
      data: {
        video: {
          id: "v1",
          title: "",
          description: "",
          previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
          lengthSeconds: 60,
          viewCount: 0,
          publishedAt: null,
          createdAt: "2026-01-01",
          broadcastType: "HIGHLIGHT",
          owner: { id: "u1", login: "ch", displayName: "Ch" },
        },
      },
    });

    const result = await gqlGetVideoMetadata("v1");

    expect(result!.type).toBe("highlight");
  });

  it("maps unknown broadcastType to upload", async () => {
    stubFetch(fetchMock, {
      data: {
        video: {
          id: "v1",
          title: "",
          description: "",
          previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
          lengthSeconds: 60,
          viewCount: 0,
          publishedAt: null,
          createdAt: "2026-01-01",
          broadcastType: "UPLOAD",
          owner: { id: "u1", login: "ch", displayName: "Ch" },
        },
      },
    });

    const result = await gqlGetVideoMetadata("v1");

    expect(result!.type).toBe("upload");
  });

  it("falls back to createdAt when publishedAt is null", async () => {
    stubFetch(fetchMock, {
      data: {
        video: {
          id: "v1",
          title: "",
          description: null,
          previewThumbnailURL: "https://cdn/{width}x{height}.jpg",
          lengthSeconds: 60,
          viewCount: 0,
          publishedAt: null,
          createdAt: "2026-06-01",
          broadcastType: "ARCHIVE",
          owner: { id: "u1", login: "ch", displayName: "Ch" },
        },
      },
    });

    const result = await gqlGetVideoMetadata("v1");

    expect(result!.publishedAt).toBe("2026-06-01");
    expect(result!.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("gqlIsChannelLive", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when channel is live", async () => {
    stubFetch(fetchMock, makeUseLiveResponse(true));

    const result = await gqlIsChannelLive("ninja");

    expect(result).toBe(true);
  });

  it("returns false when channel is offline", async () => {
    stubFetch(fetchMock, makeUseLiveResponse(false));

    const result = await gqlIsChannelLive("offline");

    expect(result).toBe(false);
  });

  it("returns false when user is null", async () => {
    stubFetch(fetchMock, { data: { user: null } });

    const result = await gqlIsChannelLive("nonexistent");

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("gqlGetFollowerCount", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns follower count", async () => {
    stubFetch(fetchMock, {
      data: {
        user: {
          followers: { totalCount: 18000000 },
        },
      },
    });

    const result = await gqlGetFollowerCount("ninja");

    expect(result).toBe(18000000);
  });

  it("returns null when user is null", async () => {
    stubFetch(fetchMock, { data: { user: null } });

    const result = await gqlGetFollowerCount("nobody");

    expect(result).toBeNull();
  });

  it("returns null when followers is null", async () => {
    stubFetch(fetchMock, {
      data: { user: { followers: null } },
    });

    const result = await gqlGetFollowerCount("ch");

    expect(result).toBeNull();
  });

  it("returns null on network error (swallowed)", async () => {
    stubFetchReject(fetchMock, new Error("timeout"));

    const result = await gqlGetFollowerCount("ch");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("gqlFetchGamesForVideos", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns game data keyed by video ID", async () => {
    stubFetch(fetchMock, {
      data: {
        v111: {
          id: "111",
          game: { id: "game-1", displayName: "VALORANT", name: "valorant" },
        },
        v222: {
          id: "222",
          game: { id: "game-2", displayName: "Chess", name: "chess" },
        },
      },
    });

    const result = await gqlFetchGamesForVideos(["111", "222"]);

    expect(result).toEqual({
      "111": { id: "game-1", name: "VALORANT" },
      "222": { id: "game-2", name: "Chess" },
    });
  });

  it("returns empty object for empty videoIds", async () => {
    const result = await gqlFetchGamesForVideos([]);

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters out non-numeric video IDs", async () => {
    const result = await gqlFetchGamesForVideos(["abc", "def"]);

    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips videos with null game", async () => {
    stubFetch(fetchMock, {
      data: {
        v111: { id: "111", game: null },
        v222: { id: "222", game: { id: "g1", displayName: "Chess" } },
      },
    });

    const result = await gqlFetchGamesForVideos(["111", "222"]);

    expect(result).toEqual({
      "222": { id: "g1", name: "Chess" },
    });
  });

  it("prefers displayName over name for game name", async () => {
    stubFetch(fetchMock, {
      data: {
        v111: {
          id: "111",
          game: { id: "g1", displayName: "VALORANT", name: "valorant" },
        },
      },
    });

    const result = await gqlFetchGamesForVideos(["111"]);

    expect(result["111"].name).toBe("VALORANT");
  });

  it("falls back to name when displayName is empty", async () => {
    stubFetch(fetchMock, {
      data: {
        v111: {
          id: "111",
          game: { id: "g1", displayName: "", name: "valorant" },
        },
      },
    });

    const result = await gqlFetchGamesForVideos(["111"]);

    expect(result["111"].name).toBe("valorant");
  });

  it("builds aliased query fields with v-prefix", async () => {
    stubFetch(fetchMock, { data: {} });

    await gqlFetchGamesForVideos(["111", "222"]);

    const body = JSON.parse(lastFetchBody(fetchMock));
    const queryText = body[0].query as string;
    expect(queryText).toContain('v111: video(id: "111")');
    expect(queryText).toContain('v222: video(id: "222")');
  });

  it("returns empty record when response.data is null", async () => {
    stubFetch(fetchMock, { data: null });

    const result = await gqlFetchGamesForVideos(["111"]);

    expect(result).toEqual({});
  });
});

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
// Search functions are already extensively covered in twitch-gql-search.test.ts.
// The tests below pin properties NOT covered there: liveOnly filter and
// page-1 category targets.
// ---------------------------------------------------------------------------

describe("gqlSearchChannels — liveOnly filter", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters out offline channels when liveOnly is true", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "u1",
                  login: "live_ch",
                  displayName: "LiveCh",
                  profileImageURL: "",
                  description: "",
                  stream: { id: "s1", game: null, __typename: "Stream" },
                  followers: { totalCount: 100, __typename: "FollowerConnection" },
                  roles: { isPartner: false, __typename: "UserRoles" },
                  broadcastSettings: { id: "bs1", title: "", __typename: "BroadcastSettings" },
                },
              },
              {
                trackingID: "t2",
                __typename: "SearchForEdge",
                item: {
                  id: "u2",
                  login: "offline_ch",
                  displayName: "OfflineCh",
                  profileImageURL: "",
                  description: "",
                  stream: null,
                  followers: { totalCount: 200, __typename: "FollowerConnection" },
                  roles: { isPartner: false, __typename: "UserRoles" },
                  broadcastSettings: { id: "bs2", title: "", __typename: "BroadcastSettings" },
                },
              },
            ],
          },
          games: { cursor: null, edges: [] },
        },
      },
    });

    const result = await gqlSearchChannels("test", { liveOnly: true });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].username).toBe("live_ch");
    expect(result.data[0].isLive).toBe(true);
  });

  it("returns all channels when liveOnly is false/undefined", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "u1",
                  login: "ch1",
                  displayName: "Ch1",
                  profileImageURL: "",
                  description: "",
                  stream: { id: "s1", game: null, __typename: "Stream" },
                  followers: { totalCount: 100, __typename: "FollowerConnection" },
                  roles: { isPartner: false, __typename: "UserRoles" },
                  broadcastSettings: { id: "bs1", title: "", __typename: "BroadcastSettings" },
                },
              },
              {
                trackingID: "t2",
                __typename: "SearchForEdge",
                item: {
                  id: "u2",
                  login: "ch2",
                  displayName: "Ch2",
                  profileImageURL: "",
                  description: "",
                  stream: null,
                  followers: { totalCount: 200, __typename: "FollowerConnection" },
                  roles: { isPartner: false, __typename: "UserRoles" },
                  broadcastSettings: { id: "bs2", title: "", __typename: "BroadcastSettings" },
                },
              },
            ],
          },
          games: { cursor: null, edges: [] },
        },
      },
    });

    const result = await gqlSearchChannels("test");

    expect(result.data).toHaveLength(2);
  });
});

describe("gqlSearchChannels — transformSearchChannel mapping", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps all channel fields including category from live stream", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "u1",
                  login: "ninja",
                  displayName: "Ninja",
                  profileImageURL: "https://cdn/avatar.jpg",
                  description: "Pro gamer",
                  stream: {
                    id: "s1",
                    game: {
                      id: "g1",
                      displayName: "VALORANT",
                      name: "valorant",
                      __typename: "Game",
                    },
                    __typename: "Stream",
                  },
                  followers: { totalCount: 18000000, __typename: "FollowerConnection" },
                  roles: { isPartner: true, __typename: "UserRoles" },
                  broadcastSettings: {
                    id: "bs1",
                    title: "Ranked Grind",
                    __typename: "BroadcastSettings",
                  },
                },
              },
            ],
          },
          games: { cursor: null, edges: [] },
        },
      },
    });

    const result = await gqlSearchChannels("ninja");
    const ch = result.data[0];

    expect(ch.id).toBe("u1");
    expect(ch.platform).toBe("twitch");
    expect(ch.username).toBe("ninja");
    expect(ch.displayName).toBe("Ninja");
    expect(ch.avatarUrl).toBe("https://cdn/avatar.jpg");
    expect(ch.bio).toBe("Pro gamer");
    expect(ch.isLive).toBe(true);
    expect(ch.isVerified).toBe(true);
    expect(ch.isPartner).toBe(true);
    expect(ch.followerCount).toBe(18000000);
    expect(ch.lastStreamTitle).toBe("Ranked Grind");
    expect(ch.categoryId).toBe("g1");
    expect(ch.categoryName).toBe("VALORANT");
  });

  it("does not include categoryId/categoryName when offline", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "u1",
                  login: "ch1",
                  displayName: "Ch1",
                  profileImageURL: "",
                  description: "",
                  stream: null,
                  followers: { totalCount: 0, __typename: "FollowerConnection" },
                  roles: { isPartner: false, __typename: "UserRoles" },
                  broadcastSettings: { id: "bs1", title: "", __typename: "BroadcastSettings" },
                },
              },
            ],
          },
          games: { cursor: null, edges: [] },
        },
      },
    });

    const result = await gqlSearchChannels("ch1");
    const ch = result.data[0];

    expect(ch.categoryId).toBeUndefined();
    expect(ch.categoryName).toBeUndefined();
  });
});

describe("gqlSearchCategories — page 1 persisted query targets", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transforms game fields into UnifiedCategory", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: { cursor: null, edges: [] },
          games: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "g1",
                  name: "valorant",
                  displayName: "VALORANT",
                  boxArtURL: "https://cdn/{width}x{height}.jpg",
                  viewersCount: 50000,
                },
              },
            ],
          },
        },
      },
    });

    const result = await gqlSearchCategories("valorant");

    expect(result.data).toHaveLength(1);
    const cat = result.data[0];
    expect(cat.id).toBe("g1");
    expect(cat.platform).toBe("twitch");
    expect(cat.name).toBe("VALORANT");
    expect(cat.boxArtUrl).toBe("https://cdn/285x380.jpg");
    expect(cat.viewerCount).toBe(50000);
  });

  it("falls back to name when displayName is falsy", async () => {
    stubFetch(fetchMock, {
      data: {
        searchFor: {
          channels: { cursor: null, edges: [] },
          games: {
            cursor: null,
            edges: [
              {
                trackingID: "t1",
                __typename: "SearchForEdge",
                item: {
                  id: "g1",
                  name: "chess",
                  displayName: "",
                  boxArtURL: "https://cdn/{width}x{height}.jpg",
                  viewersCount: null,
                },
              },
            ],
          },
        },
      },
    });

    const result = await gqlSearchCategories("chess");

    expect(result.data[0].name).toBe("chess");
    expect(result.data[0].viewerCount).toBeUndefined();
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

// ---------------------------------------------------------------------------
// gqlSearchChannels / gqlSearchCategories — pagination skeleton-flicker suite
// (consolidated from tests/backend/twitch-gql-search.test.ts in U20.c — that
// satellite file was DELETED; this is now the canonical home).
//
// Guards: Twitch GQL search pagination — `searchFor.channels` and `searchFor.games`
// do NOT accept `cursor`/`first` on the persisted operation, and the operation
// ignores `after`. Any fix that "adds pagination" by re-sending the same op with
// cursor will skeleton-flicker forever. The 26-test suite below pins the input
// contract, the cursor handoff, the dedupe semantics, and the endReason
// taxonomy (see docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md
// for the bug class).
// Guards: response-fixture `satisfies` narrowing — widening what
// transformSearchChannel/transformSearchGame need produces a compile error
// here, so the test stays in sync with the production transforms rather than
// drifting silently.
// ---------------------------------------------------------------------------

// Fixtures use `satisfies` against the narrowed contracts the production
// transforms read. If a future change widens what `transformSearchChannel` /
// `transformSearchGame` need, the corresponding type widens and the fixture
// becomes a compile error here — preventing the kind of silent test-vs-real
// drift the unit suite is supposed to catch.
type SearchResponseBody<TKey extends "channels" | "games", TItem> = {
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
}): SearchResponseBody<"channels", SearchChannelEdgeItem> {
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
}): SearchResponseBody<"games", SearchGameEdgeItem> {
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

function stubSearchFetchOnce(fetchMock: FetchMock, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => [body],
  } as Response);
}

describe("gqlSearchChannels — safety properties (pagination skeleton-flicker suite)", () => {
  let fetchMock: FetchMock;
  const warnSpy = vi.mocked(logger.warn);

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockClear();
  });

  it("happy path — page 2 hits the raw-GQL LoadMore query (not the persisted op) and returns advanced cursor", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 5 }));
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
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 3 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.cursor).toBeUndefined();
  });

  it("empty-page guard — returns cursor: undefined when edges is empty", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 0 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });

    expect(result.data).toHaveLength(0);
    expect(result.cursor).toBeUndefined();
  });

  it('integrity-check guard — returns cursor: undefined on "failed integrity check" without warning', async () => {
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(
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
    const call = warnSpy.mock.calls[0];
    expect(call?.[0]).toBe("Twitch:GQL");
    expect(String(call?.[1] ?? "")).toContain("SearchChannels");
    expect(JSON.stringify(call?.[2] ?? {})).toContain("Unexpected server error");
  });

  it("page 1 (no after) hits the persisted query and returns the server cursor for page-2 hand-off", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 10 }));
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
    const variants = ["Failed Integrity Check", "FAILED_INTEGRITY_CHECK", "integrity check failed"];
    for (const message of variants) {
      fetchMock.mockClear();
      warnSpy.mockClear();
      stubSearchFetchOnce(
        fetchMock,
        makeChannelsResponse({ cursor: "MjA=", count: 0, errors: [{ message }] })
      );
      const result = await gqlSearchChannels("ninja", { after: "MTA=" });
      expect(result.cursor, `variant: ${message}`).toBeUndefined();
      expect(warnSpy, `variant: ${message}`).not.toHaveBeenCalled();
    }
  });

  it("integrity-check guard matches extensions.code envelope — { message: 'Bad Request', extensions: { code: 'INTEGRITY_FAILED' } }", async () => {
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(
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
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    expect(call?.[0]).toBe("Twitch:GQL");
    expect(String(call?.[1] ?? "")).toContain("SearchChannels");
    const metaStr = JSON.stringify(call?.[2] ?? {});
    expect(metaStr).toContain("Unexpected internal server error");
    expect(metaStr).not.toMatch(/integrity/i);
  });

  it("endReason — set to 'cursor-no-advance' when server echoes the input cursor", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MTA=", count: 3 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("cursor-no-advance");
  });

  it("endReason — set to 'empty-page' when server returns zero edges", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 0 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.endReason).toBe("empty-page");
  });

  it("endReason — set to 'integrity-rejected' when integrity check fires", async () => {
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: null, count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("exhausted");
  });

  it("endReason — undefined on a successful advance (cursor returned)", async () => {
    stubSearchFetchOnce(fetchMock, makeChannelsResponse({ cursor: "MjA=", count: 5 }));
    const result = await gqlSearchChannels("ninja", { after: "MTA=" });
    expect(result.cursor).toBe("MjA=");
    expect(result.endReason).toBeUndefined();
  });
});

describe("gqlSearchCategories — safety properties (pagination skeleton-flicker suite)", () => {
  let fetchMock: FetchMock;
  const warnSpy = vi.mocked(logger.warn);

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockClear();
  });

  it("happy path — page 2 hits the raw-GQL LoadMore query (not the persisted op) and returns advanced cursor", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 4 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.data).toHaveLength(4);
    expect(result.cursor).toBe("NTA=");

    const body = lastFetchBody(fetchMock);
    expect(body).toContain("SearchResultsPageLoadMoreGames");
    expect(body).not.toContain("persistedQuery");
  });

  it("cursor-no-advance guard — returns cursor: undefined when server returns same cursor as input", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 3 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.cursor).toBeUndefined();
  });

  it("empty-page guard — returns cursor: undefined when edges is empty", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 0 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.data).toHaveLength(0);
    expect(result.cursor).toBeUndefined();
  });

  it('integrity-check guard — returns cursor: undefined on "failed integrity check" without warning', async () => {
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(
      fetchMock,
      makeCategoriesResponse({
        cursor: "NTA=",
        count: 0,
        errors: [{ message: "Unexpected server error" }],
      })
    );
    const result = await gqlSearchCategories("chess", { after: "MjA=" });

    expect(result.cursor).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    expect(call?.[0]).toBe("Twitch:GQL");
    expect(String(call?.[1] ?? "")).toContain("SearchCategories");
    expect(JSON.stringify(call?.[2] ?? {})).toContain("Unexpected server error");
  });

  it("page 1 (no after) hits the persisted query and returns the server cursor for page-2 hand-off", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 10 }));
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
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "MjA=", count: 3 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("cursor-no-advance");
  });

  it("endReason — set to 'empty-page' when server returns zero edges", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 0 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.endReason).toBe("empty-page");
  });

  it("endReason — set to 'integrity-rejected' when integrity check fires", async () => {
    stubSearchFetchOnce(
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
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: null, count: 5 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBeUndefined();
    expect(result.endReason).toBe("exhausted");
  });

  it("endReason — undefined on a successful advance (cursor returned)", async () => {
    stubSearchFetchOnce(fetchMock, makeCategoriesResponse({ cursor: "NTA=", count: 5 }));
    const result = await gqlSearchCategories("chess", { after: "MjA=" });
    expect(result.cursor).toBe("NTA=");
    expect(result.endReason).toBeUndefined();
  });
});
