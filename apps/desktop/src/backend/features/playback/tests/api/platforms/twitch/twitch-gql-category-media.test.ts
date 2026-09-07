import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@backend/api/unified/platform-health", () => ({
  recordPlatformSuccess: vi.fn(),
  recordPlatformFailure: vi.fn(),
}));
import {
  gqlGetCategoryClips,
  gqlGetCategoryVideos,
} from "@backend/features/playback/adapters/twitch/twitch-gql-category-media";

const owner = {
  id: "123",
  login: "artist",
  displayName: "Artist",
  profileImageURL: "https://example.com/avatar.jpg",
};
const game = { id: "509660", name: "Art" };
const video = {
  id: "1234",
  title: "Finished artwork",
  lengthSeconds: 300,
  viewCount: 42,
  publishedAt: "2026-09-06T10:00:00Z",
  previewThumbnailURL: "https://example.com/video.jpg",
  status: "RECORDED",
  broadcastType: "ARCHIVE",
  language: "en",
  owner,
  game,
};
const clip = {
  slug: "ArtistClip-slug",
  title: "Paint reveal",
  durationSeconds: 20,
  viewCount: 81,
  createdAt: "2026-09-06T10:00:00Z",
  thumbnailURL: "https://example.com/clip.jpg",
  language: "EN",
  broadcaster: owner,
  curator: { displayName: "Viewer" },
  game,
};
const fetchMock = vi.fn();
function respond(body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [body] });
}
function connection(nodes: unknown[], cursor: string | null = null) {
  return {
    edges: nodes.map((node) => ({ node, cursor })),
    pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
  };
}
function requestBody() {
  return JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)[0];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Guards: category reads use the anonymous primary with provider filters/cursors and never require OAuth.
// Guards: live recordings are not VOD cards; errors and malformed or repeated pages never become empty success.
describe("public Twitch category media", () => {
  it("maps recorded category videos and excludes in-progress recordings while preserving page position", async () => {
    respond({
      data: {
        game: {
          ...game,
          videos: {
            ...connection([video, { ...video, id: "live", status: "RECORDING" }], "next"),
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      },
    });
    const page = await gqlGetCategoryVideos("509660", {
      limit: 60,
      cursor: "before",
      sort: "popular",
      language: "en",
    });
    expect(page).toMatchObject({
      data: [
        {
          id: "1234",
          channelName: "artist",
          channelAvatar: owner.profileImageURL,
          categoryId: "509660",
          isLive: false,
        },
      ],
      cursor: "next",
    });
    expect(requestBody().variables).toEqual({
      id: "509660",
      first: 60,
      after: "before",
      sort: "VIEWS",
      languages: ["en"],
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("maps playable clip slugs and forwards time, language and continuation filters", async () => {
    respond({ data: { game: { ...game, clips: connection([clip], "page-two") } } });
    const page = await gqlGetCategoryClips("509660", {
      limit: 20,
      cursor: "page-one",
      timeRange: "week",
      language: "en",
    });
    expect(page).toMatchObject({
      data: [
        {
          id: clip.slug,
          clipUrl: `https://clips.twitch.tv/${clip.slug}`,
          creatorName: "Viewer",
          categoryName: "Art",
        },
      ],
      cursor: "page-two",
    });
    expect(requestBody().variables).toEqual({
      id: "509660",
      first: 20,
      after: "page-one",
      filter: "LAST_WEEK",
      languages: ["EN"],
    });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it.each(["videos", "clips"] as const)(
    "preserves successful empty %s while rejecting provider and shape failures",
    async (kind) => {
      const read = kind === "videos" ? gqlGetCategoryVideos : gqlGetCategoryClips;
      respond({ data: { game: { ...game, [kind]: connection([]) } } });
      await expect(read("509660")).resolves.toEqual({ data: [], cursor: undefined });
      respond({ errors: [{ message: "Provider unavailable" }] });
      await expect(read("509660")).rejects.toThrow("Provider unavailable");
      respond({ data: { game: { ...game, [kind]: {} } } });
      await expect(read("509660")).rejects.toThrow();
      respond({ data: { game: null } });
      await expect(read("509660")).rejects.toThrow("category was not found");
    }
  );

  it("does not loop or manufacture a cursor when the provider repeats or omits its continuation", async () => {
    respond({ data: { game: { ...game, clips: connection([clip], "same") } } });
    await expect(gqlGetCategoryClips("509660", { cursor: "same" })).rejects.toThrow(
      "non-advancing"
    );
    respond({
      data: {
        game: {
          ...game,
          videos: { ...connection([video]), pageInfo: { hasNextPage: true, endCursor: null } },
        },
      },
    });
    await expect(gqlGetCategoryVideos("509660")).rejects.toThrow("non-advancing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an all-recording page's cursor for explicit continuation without scanning automatically", async () => {
    respond({
      data: {
        game: {
          ...game,
          videos: connection([{ ...video, status: "RECORDING" }], "recorded-later"),
        },
      },
    });
    await expect(gqlGetCategoryVideos("509660")).resolves.toEqual({
      data: [],
      cursor: "recorded-later",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
