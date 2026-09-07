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
  gqlGetClipAccessToken,
  gqlGetClipsByChannel,
  gqlGetPlaybackAccessToken,
  gqlGetVideoMetadata,
  gqlGetVideosByChannel,
  gqlGetVodAccessToken,
} from "@backend/features/playback/adapters/twitch/twitch-gql-playback";

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

function lastFetchBody(fetchMock: FetchMock): string {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ?? "";
}

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
