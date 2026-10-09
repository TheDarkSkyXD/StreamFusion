import { describe, expect, it } from "vitest";

import { createTwitchHelixCategoryReads } from "../adapters/twitch/twitch-helix-category-reader";

const game = { id: "509658", name: "Just Chatting" };
const owner = {
  id: "42",
  login: "ada",
  displayName: "Ada",
  profileImageURL: "https://cdn.example/avatar.png",
};

function reader(payload: unknown, token: string | null = null) {
  const requests: { query: string; variables: Record<string, unknown> }[] = [];
  const reads = createTwitchHelixCategoryReads({
    clientId: "client",
    readAccessToken: async () => token,
    fetch: async (url, init) => {
      expect(url).toBe("https://gql.twitch.tv/gql");
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  return { reads, requests };
}

describe("Twitch category media", () => {
  it.each([null, "signed-in-token"])("reads category clips with token %s", async (token) => {
    const { reads, requests } = reader({
      data: {
        game: {
          ...game,
          clips: {
            edges: [{ node: {
              slug: "clip-1", title: "Moment", durationSeconds: 24,
              viewCount: 12, createdAt: "2026-09-01T10:00:00Z",
              thumbnailURL: "https://cdn.example/clip.jpg", language: "EN",
              broadcaster: owner, curator: { displayName: "Viewer" }, game,
            } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }, token);

    const result = await reads.getCategoryClips({ categoryId: game.id, timeRange: "week" });
    expect(result.status).toBe("complete");
    expect(result.items).toEqual([expect.objectContaining({
      id: "clip-1", categoryId: game.id, categoryName: game.name,
      channelId: owner.id, channelAvatar: owner.profileImageURL,
      creatorName: "Viewer", clipUrl: "https://clips.twitch.tv/clip-1",
      createdAt: "2026-09-01T10:00:00.000Z",
    })]);
    expect(requests[0]?.variables).toMatchObject({ id: game.id, filter: "LAST_WEEK" });
  });

  it("reads completed videos with requested sort and excludes recordings", async () => {
    const video = {
      id: "100", title: "Archive", lengthSeconds: 3600, viewCount: 50,
      publishedAt: "2026-09-01T10:00:00Z", previewThumbnailURL: "https://cdn.example/vod.jpg",
      status: "RECORDED", broadcastType: "ARCHIVE", language: "en", owner, game,
    };
    const { reads, requests } = reader({ data: { game: {
      ...game, videos: { edges: [
        { node: video }, { node: { ...video, id: "101", status: "RECORDING" } },
      ], pageInfo: { hasNextPage: false, endCursor: null } },
    } } });

    const result = await reads.getCategoryVideos({ categoryId: game.id, sort: "views" });
    expect(result.items).toEqual([expect.objectContaining({
      id: "100", categoryId: game.id, categoryName: game.name,
      channelId: owner.id, type: "archive", url: "https://www.twitch.tv/videos/100",
    })]);
    expect(requests[0]?.variables).toMatchObject({ id: game.id, sort: "VIEWS" });
  });

  it("fails when GQL responds with errors", async () => {
    const { reads } = reader({ errors: [{ message: "Bad query" }], data: { game: null } });
    const result = await reads.getCategoryVideos({ categoryId: game.id, sort: "recent" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("twitch-failed");
  });

  it.each([
    ["day", "LAST_DAY"],
    ["month", "LAST_MONTH"],
    ["all", "ALL_TIME"],
  ] as const)("requests %s clips", async (timeRange, filter) => {
    const { reads, requests } = reader({ data: { game: {
      ...game, clips: { edges: [] },
    } } });
    expect((await reads.getCategoryClips({ categoryId: game.id, timeRange })).status).toBe("complete");
    expect(requests[0]?.variables.filter).toBe(filter);
  });

  it("requests videos by recent publication time", async () => {
    const { reads, requests } = reader({ data: { game: {
      ...game, videos: { edges: [] },
    } } }, "signed-in-token");
    expect((await reads.getCategoryVideos({ categoryId: game.id, sort: "recent" })).status).toBe("complete");
    expect(requests[0]?.variables.sort).toBe("TIME");
  });

  it("fails on malformed media data", async () => {
    const { reads } = reader({ data: { game: { ...game, clips: {} } } });
    const result = await reads.getCategoryClips({ categoryId: game.id, timeRange: "all" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("twitch-failed");
  });
});
