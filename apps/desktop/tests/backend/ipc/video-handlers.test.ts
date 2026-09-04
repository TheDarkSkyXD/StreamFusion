import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: this is the canonical test file for the video-handlers IPC surface
// after the U20.c consolidation. It owns:
//   - pure helpers: getCutoffMs, fillPageWithCutoff (cutoff math + pagination edges)
//   - handleGetClipsByChannel: strict-cutoff loop for both Kick & Twitch, including
//     the LAST_DAY/LAST_WEEK/MONTH/ALL_TIME filter wiring, view-sort Deep Fetch,
//     and the MAX_INTERNAL_PAGES (5) safety cap
//   - IPC-handler surface: registerVideoHandlers + per-channel routing for
//     VIDEOS_GET_PLAYBACK_URL, VIDEOS_GET_METADATA, VIDEOS_GET_BY_CHANNEL,
//     CLIPS_GET_PLAYBACK_URL, VIDEOS_GET_BY_LIVESTREAM_ID (the duplicate
//     tests/backend/ipc/handlers/video-handlers.test.ts was DELETED in U20.c —
//     its non-clips channel coverage was migrated into the IPC-handler describes
//     at the bottom of this file).

import { IPC_CHANNELS, type IpcResult, type PaginatedIpcResult } from "@shared/ipc-channels";
import type { UnifiedClip, UnifiedVideo } from "@shared/platform-types";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/api/platforms/twitch/twitch-stream-resolver", () => {
  const proto = {
    getVodPlaybackUrl: vi.fn(),
    getClipPlaybackUrl: vi.fn(),
  };
  function MockTwitchStreamResolver() {}
  MockTwitchStreamResolver.prototype = proto;
  return { TwitchStreamResolver: MockTwitchStreamResolver };
});

vi.mock("@backend/api/platforms/kick/kick-stream-resolver", () => {
  const proto = {
    getVodPlaybackUrl: vi.fn(),
    getVideoMetadata: vi.fn(),
  };
  function MockKickStreamResolver() {}
  MockKickStreamResolver.prototype = proto;
  return { KickStreamResolver: MockKickStreamResolver };
});

vi.mock("@backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    platform: "kick" as const,
    getClips: vi.fn(),
    getClipsByCategory: vi.fn(),
    getVideos: vi.fn(),
    getStreamsByCategory: vi.fn(),
    readChannelVideos: vi.fn(),
    readCategoryVideos: vi.fn(),
    readChannelClips: vi.fn(),
    readCategoryClips: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    platform: "twitch" as const,
    getClipsByChannel: vi.fn(),
    getClipsByGame: vi.fn(),
    getUsersById: vi.fn(),
    getVideoById: vi.fn(),
    getVideosByChannel: vi.fn(),
    getVideosByGame: vi.fn(),
    getVideosByUser: vi.fn(),
    getVideosGameData: vi.fn(),
    getTopStreams: vi.fn(),
    readChannelVideos: vi.fn(),
    readCategoryVideos: vi.fn(),
    readChannelClips: vi.fn(),
    readCategoryClips: vi.fn(),
  },
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@backend/api/platforms/kick/kick-client";
import { KickStreamResolver } from "@backend/api/platforms/kick/kick-stream-resolver";
import { logger } from "@backend/logging/logger";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import { TwitchStreamResolver } from "@backend/api/platforms/twitch/twitch-stream-resolver";
import {
  fillPageWithCutoff,
  getCutoffMs,
  handleGetClipsByChannel,
  registerVideoHandlers,
} from "@backend/ipc/handlers/video-handlers";

const DAY_MS = 24 * 60 * 60 * 1000;
const FROZEN_NOW = new Date("2026-06-06T12:00:00.000Z").getTime();

const getClipsMock = vi.mocked(kickClient.getClips);
const getClipsByCategoryMock = vi.mocked(kickClient.getClipsByCategory);
const getVideosMock = vi.mocked(kickClient.getVideos);
const getStreamsByCategoryMock = vi.mocked(kickClient.getStreamsByCategory);
const twitchGetClipsByChannelMock = vi.mocked(twitchClient.getClipsByChannel);
const twitchGetClipsByGameMock = vi.mocked(twitchClient.getClipsByGame);
const twitchGetVideosByGameMock = vi.mocked(twitchClient.getVideosByGame);
const twitchGetVideosByChannelMock = vi.mocked(twitchClient.getVideosByChannel);
const twitchGetVideosByUserMock = vi.mocked(twitchClient.getVideosByUser);
const twitchGetTopStreamsMock = vi.mocked(twitchClient.getTopStreams);
const twitchGetUsersByIdMock = vi.mocked(twitchClient.getUsersById);
const kickReadCategoryClipsMock = vi.mocked(kickClient.readCategoryClips);
const kickReadCategoryVideosMock = vi.mocked(kickClient.readCategoryVideos);
const twitchReadCategoryClipsMock = vi.mocked(twitchClient.readCategoryClips);
const twitchReadCategoryVideosMock = vi.mocked(twitchClient.readCategoryVideos);
type ClipAgeRow = readonly [id: string, ageMs: number];
type KickClip = Awaited<ReturnType<typeof kickClient.getClips>>["data"][number];
type TwitchClip = Awaited<ReturnType<typeof twitchClient.getClipsByChannel>>["data"][number];
type KickCategoryClip = Awaited<ReturnType<typeof kickClient.getClipsByCategory>>["data"][number];
type KickVideo = Awaited<ReturnType<typeof kickClient.getVideos>>["data"][number];
type TestKickVideo = KickVideo & { livestreamId?: string; live_stream_id?: string };

function expectSuccessful<T extends { success: boolean }>(
  result: T
): asserts result is T & {
  success: true;
  data: T extends { data?: infer Data } ? NonNullable<Data> : never;
} {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`Expected successful result`);
}

function kickCategoryClip(overrides: Partial<KickCategoryClip> = {}): KickCategoryClip {
  return {
    id: "kick-clip-1",
    title: "Kick clip",
    duration: "0:30",
    views: "1",
    date: "1/1/2026",
    created_at: "2026-01-01T00:00:00Z",
    creatorName: "Clipper",
    embedUrl: "https://example.com/clip.mp4",
    url: "https://kick.com/channel/clips/kick-clip-1",
    shareUrl: "https://kick.com/channel/clips/kick-clip-1",
    gameId: "15",
    gameName: "Just Chatting",
    category: "Just Chatting",
    thumbnailUrl: "https://example.com/clip.jpg",
    vodId: "vod-1",
    channelId: "channel-1",
    channelName: "channel",
    channelDisplayName: "Channel",
    channelAvatar: "https://example.com/avatar.jpg",
    platform: "kick",
    ...overrides,
  };
}

function unifiedVideo(overrides: Partial<UnifiedVideo> = {}): UnifiedVideo {
  return {
    id: "v1",
    platform: "twitch",
    channelId: "c1",
    channelName: "streamer",
    channelDisplayName: "Streamer",
    channelAvatar: "https://avatar.jpg",
    title: "Stream",
    description: "desc",
    thumbnailUrl: "https://thumb.jpg",
    duration: 3661,
    viewCount: 5000,
    publishedAt: "2026-01-01T00:00:00Z",
    url: "https://twitch.tv/videos/v1",
    type: "archive",
    ...overrides,
  };
}

function unifiedClip(overrides: Partial<UnifiedClip> = {}): UnifiedClip {
  return {
    id: "clip-1",
    platform: "twitch",
    channelId: "c1",
    channelName: "streamer",
    channelDisplayName: "Streamer",
    channelAvatar: "https://avatar.jpg",
    title: "Clip",
    thumbnailUrl: "https://clip-thumb.jpg",
    clipUrl: "https://clips.twitch.tv/clip-1",
    shareUrl: "https://clips.twitch.tv/clip-1",
    embedUrl: "https://clips.twitch.tv/embed/clip-1",
    duration: 30,
    viewCount: 42,
    createdAt: "2026-01-01T00:00:00Z",
    creatorName: "Clipper",
    ...overrides,
  };
}

function kickVideo(overrides: Partial<TestKickVideo> = {}): TestKickVideo {
  return {
    id: "v1",
    uuid: "uuid-v1",
    slug: "video-v1",
    title: "Kick VOD",
    duration: "1:00",
    sourceDurationMs: 60_000,
    views: "1",
    date: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    sourceCreatedAt: "2026-01-01T00:00:00Z",
    sourceEndedAt: "2026-01-01T01:00:00Z",
    thumbnailUrl: "https://example.com/vod.jpg",
    source: "https://example.com/vod.m3u8",
    url: "https://kick.com/video/video-v1",
    shareUrl: "https://kick.com/video/video-v1",
    platform: "kick",
    isLive: false,
    isSubOnly: false,
    channelSlug: "test",
    channelName: "Test",
    channelAvatar: null,
    category: "Just Chatting",
    language: "en",
    ...overrides,
  };
}

function clip(
  id: string,
  ageMs: number,
  extras: { views?: string | number; title?: string; created_at?: string } = {}
): KickClip {
  return {
    id,
    title: extras.title ?? `Clip ${id}`,
    duration: "0:30",
    views: String(extras.views ?? 1),
    date: new Date(FROZEN_NOW - ageMs).toLocaleDateString(),
    created_at: extras.created_at ?? new Date(FROZEN_NOW - ageMs).toISOString(),
    thumbnailUrl: "",
    vodId: "",
    creatorName: "creator",
    embedUrl: "",
    url: "",
    shareUrl: "",
    gameName: "",
    isLive: false,
    channelSlug: "channel",
  };
}

function twitchClip(
  id: string,
  ageMs: number,
  extras: { viewCount?: number; title?: string } = {}
): TwitchClip {
  return {
    id,
    title: extras.title ?? `Twitch clip ${id}`,
    duration: 30,
    viewCount: extras.viewCount ?? 1,
    createdAt: new Date(FROZEN_NOW - ageMs).toISOString(),
    thumbnailUrl: "",
    embedUrl: "",
    clipUrl: "",
    platform: "twitch",
    channelId: "channel-id",
    channelName: "channel",
    channelDisplayName: "Channel",
    channelAvatar: "",
    creatorName: "creator",
  };
}

function mockTwitchClipBuckets(
  buckets: Record<string, { data: ReturnType<typeof twitchClip>[]; cursor?: string }>
): void {
  twitchGetClipsByChannelMock.mockImplementation(async (_channelLogin, options) => {
    const filter = String(options?.filter);
    return buckets[filter] ?? { data: [], cursor: undefined };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  getClipsMock.mockReset();
  getVideosMock.mockReset();
  getVideosMock.mockResolvedValue({ data: [] });
  twitchGetClipsByChannelMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCutoffMs", () => {
  it("returns null for 'all' and undefined", () => {
    expect(getCutoffMs(undefined, FROZEN_NOW)).toBeNull();
    expect(getCutoffMs("all", FROZEN_NOW)).toBeNull();
  });

  it("computes day / week / month cutoffs from nowMs", () => {
    expect(getCutoffMs("day", FROZEN_NOW)).toBe(FROZEN_NOW - DAY_MS);
    expect(getCutoffMs("week", FROZEN_NOW)).toBe(FROZEN_NOW - 7 * DAY_MS);
    expect(getCutoffMs("month", FROZEN_NOW)).toBe(FROZEN_NOW - 30 * DAY_MS);
  });
});

describe("fillPageWithCutoff", () => {
  const baseCutoff = FROZEN_NOW - DAY_MS;

  it("returns 'filled' with ALL in-range items from the page (no mid-page trim) and forwards the cursor", async () => {
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 2,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async () => ({
        items: [clip("a", DAY_MS / 4), clip("b", DAY_MS / 3), clip("c", DAY_MS / 2)],
        cursor: "next-100",
      }),
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.reason).toBe("filled");
    // All three items are in-range — return all three even though limit is 2.
    // Trimming mid-page would lose item "c" (upstream cursor advances past it).
    expect(result.inRange.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.nextCursor).toBe("next-100");
    expect(result.pagesFetched).toBe(1);
  });

  it("stops on 'out-of-range' and returns cursor=undefined", async () => {
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 20,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async () => ({
        items: [clip("a", 1000), clip("b", DAY_MS - 1000), clip("c", DAY_MS + 60_000)],
        cursor: "next-100",
      }),
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.reason).toBe("out-of-range");
    expect(result.inRange.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("treats inclusive boundary correctly: createdAt === cutoff is in-range", async () => {
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 20,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async () => ({
        items: [clip("on-edge", DAY_MS), clip("just-past", DAY_MS + 1)],
        cursor: "next",
      }),
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.inRange.map((c) => c.id)).toEqual(["on-edge"]);
    expect(result.reason).toBe("out-of-range");
  });

  it("returns 'exhausted' when upstream returns an empty page", async () => {
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 20,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async () => ({ items: [], cursor: undefined }),
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.reason).toBe("exhausted");
    expect(result.inRange).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns 'exhausted' when upstream gives back no next cursor mid-fill", async () => {
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 20,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async () => ({
        items: [clip("a", 1000), clip("b", 2000)],
        cursor: undefined,
      }),
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.reason).toBe("exhausted");
    expect(result.inRange.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns 'max-pages' and keeps the cursor when the safety cap trips first", async () => {
    let page = 0;
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 1000,
      initialCursor: undefined,
      maxInternalPages: 3,
      fetchPage: async () => {
        page++;
        return {
          items: Array.from({ length: 10 }, (_, i) => clip(`p${page}-${i}`, 1000 * i)),
          cursor: `after-page-${page}`,
        };
      },
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.reason).toBe("max-pages");
    expect(result.pagesFetched).toBe(3);
    expect(result.inRange).toHaveLength(30);
    expect(result.nextCursor).toBe("after-page-3");
  });

  it("walks multiple upstream pages until limit is reached, returning all items from drained pages", async () => {
    let page = 0;
    const result = await fillPageWithCutoff<ReturnType<typeof clip>>({
      cutoffMs: baseCutoff,
      limit: 15,
      initialCursor: undefined,
      maxInternalPages: 5,
      fetchPage: async (cursor) => {
        page++;
        return {
          items: Array.from({ length: 10 }, (_, i) => clip(`p${page}-${i}`, 1000)),
          cursor: page < 3 ? `cursor-${page}` : undefined,
        };
      },
      getCreatedAtMs: (c) => new Date(c.created_at).getTime(),
    });

    expect(result.pagesFetched).toBe(2);
    // Two 10-item pages = 20 items, all in-range. We don't trim past `limit`.
    expect(result.inRange).toHaveLength(20);
    expect(result.reason).toBe("filled");
    expect(result.nextCursor).toBe("cursor-2");
  });
});

describe("handleGetClipsByChannel - Kick - strict cutoff", () => {
  it.each([
    [
      "day" as const,
      [
        ["twelve-hours", DAY_MS / 2],
        ["one-minute", 60_000],
        ["one-hour", 60 * 60_000],
      ] as const satisfies readonly ClipAgeRow[],
    ],
    [
      "week" as const,
      [
        ["five-days", 5 * DAY_MS],
        ["one-minute", 60_000],
        ["one-day", DAY_MS],
      ] as const satisfies readonly ClipAgeRow[],
    ],
    [
      "month" as const,
      [
        ["twelve-days", 12 * DAY_MS],
        ["one-minute", 60_000],
        ["one-day", DAY_MS],
      ] as const satisfies readonly ClipAgeRow[],
    ],
  ])("sorts %s Most Recent clips by clip age, newest first", async (timeRange, rows) => {
    getClipsMock.mockResolvedValueOnce({
      data: rows.map(([id, ageMs]) => clip(id, ageMs)),
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange,
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual([rows[1][0], rows[2][0], rows[0][0]]);
  });

  it("returns all in-range clips and cursor=undefined when upstream is exhausted under limit", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 1000), clip("b", DAY_MS / 2), clip("c", DAY_MS - 1000)],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("sorts Kick microsecond timestamps as real dates for Most Recent", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [
        clip("older", 2 * 60_000, { created_at: "2026-06-06T11:58:00.297186Z" }),
        clip("newer", 60_000, { created_at: "2026-06-06T11:59:00.123456Z" }),
      ],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["newer", "older"]);
  });

  it("returns only in-range clips and cursor=undefined when a page contains an out-of-range clip", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [
        clip("recent-1", 1000),
        clip("recent-2", DAY_MS / 2),
        clip("old-1", DAY_MS + 60_000),
        clip("old-2", 2 * DAY_MS),
      ],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["recent-1", "recent-2"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns empty array and cursor=undefined when no clips are in range", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("old-1", DAY_MS + 1000), clip("old-2", 2 * DAY_MS)],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
    expect(res.cursor).toBeUndefined();
  });

  it("applies a 7-day cutoff for timeRange='week' (mixed near the boundary)", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [
        clip("fresh", 1000),
        clip("just-inside-7d", 7 * DAY_MS - 1000),
        clip("just-outside-7d", 7 * DAY_MS + 1000),
        clip("far-out", 14 * DAY_MS),
      ],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["fresh", "just-inside-7d"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns all clips when every clip is inside the 7-day window", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 1000), clip("b", 3 * DAY_MS), clip("c", 6 * DAY_MS)],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns no clips when everything is older than 7 days", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 7 * DAY_MS + 1000), clip("b", 10 * DAY_MS)],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data).toEqual([]);
    expect(res.cursor).toBeUndefined();
  });

  it("applies a 30-day cutoff for timeRange='month' (mixed near the boundary)", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [
        clip("fresh", 1000),
        clip("just-inside-30d", 30 * DAY_MS - 1000),
        clip("just-outside-30d", 30 * DAY_MS + 1000),
        clip("far-out", 60 * DAY_MS),
      ],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["fresh", "just-inside-30d"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns all clips when every clip is inside the 30-day window", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 1000), clip("b", 14 * DAY_MS), clip("c", 29 * DAY_MS)],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns no clips when everything is older than 30 days", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 30 * DAY_MS + 1000), clip("b", 100 * DAY_MS)],
      cursor: "next-100",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data).toEqual([]);
    expect(res.cursor).toBeUndefined();
  });

  it("forwards the upstream cursor when the page fills the UI limit (returns all drained in-range items)", async () => {
    const items = Array.from({ length: 25 }, (_, i) => clip(`c${i}`, 1000 * i));
    getClipsMock.mockResolvedValueOnce({ data: items, cursor: "next-100" });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    // All 25 in-range clips from the page are returned (no mid-page trim).
    expect(res.data).toHaveLength(25);
    expect(res.cursor).toBe("next-100");
  });

  it("uses an upstream page size of 100 (not the UI limit) for the strict-cutoff loop", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 1000), clip("old", DAY_MS + 1000)],
      cursor: "next-100",
    });

    await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(getClipsMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ limit: 100 })
    );
  });
});

describe("handleGetClipsByChannel - Kick - All Time pass-through", () => {
  it("sorts All Time Most Recent clips by clip age, newest first", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("old", 100 * DAY_MS), clip("one-minute", 60_000), clip("one-day", DAY_MS)],
      cursor: "upstream-abc",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["one-minute", "one-day", "old"]);
    expect(res.cursor).toBe("upstream-abc");
  });

  it("does not apply a cutoff and forwards the upstream cursor when timeRange='all'", async () => {
    getClipsMock.mockResolvedValueOnce({
      data: [clip("a", 1000), clip("old", 100 * DAY_MS)],
      cursor: "upstream-abc",
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "old"]);
    expect(res.cursor).toBe("upstream-abc");
  });

  it("uses the UI limit (not 100) on the All Time path", async () => {
    getClipsMock.mockResolvedValueOnce({ data: [], cursor: undefined });

    await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(getClipsMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ limit: 20 })
    );
  });
});

describe("handleGetClipsByChannel - Kick - views-sort + day/week/month Deep Fetch regression", () => {
  it("runs Deep Fetch (multi-page, views-sorted, cursor=undefined) for sort=views + timeRange=day", async () => {
    // Single Deep Fetch page sufficient — Deep Fetch stops on no-cursor.
    getClipsMock.mockResolvedValueOnce({
      data: [
        clip("low", 1000, { views: 5 }),
        clip("high", DAY_MS / 2, { views: 99 }),
        clip("mid", DAY_MS - 1000, { views: 42 }),
      ],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 5,
      sort: "views",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["high", "mid", "low"]);
    expect(res.cursor).toBeUndefined();
    // Deep Fetch always asks for limit=100
    expect(getClipsMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ limit: 100, sort: "date" })
    );
  });
});

describe("handleGetClipsByChannel - Twitch - strict cutoff", () => {
  it.each([
    [
      "day" as const,
      [
        ["twelve-hours", DAY_MS / 2],
        ["one-minute", 60_000],
        ["one-hour", 60 * 60_000],
      ] as const satisfies readonly ClipAgeRow[],
    ],
    [
      "week" as const,
      [
        ["five-days", 5 * DAY_MS],
        ["one-minute", 60_000],
        ["one-day", DAY_MS],
      ] as const satisfies readonly ClipAgeRow[],
    ],
    [
      "month" as const,
      [
        ["twelve-days", 12 * DAY_MS],
        ["one-minute", 60_000],
        ["one-day", DAY_MS],
      ] as const satisfies readonly ClipAgeRow[],
    ],
  ])("sorts %s Most Recent clips by clip age, newest first", async (timeRange, rows) => {
    const data = rows.map(([id, ageMs]) => twitchClip(id, ageMs));
    if (timeRange === "day") {
      twitchGetClipsByChannelMock.mockResolvedValueOnce({ data, cursor: undefined });
    } else {
      mockTwitchClipBuckets({
        LAST_DAY: { data: [] },
        LAST_WEEK: { data },
        LAST_MONTH: { data },
      });
    }

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange,
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual([rows[1][0], rows[2][0], rows[0][0]]);
  });

  it("returns all in-range clips and cursor=undefined when GQL is exhausted under limit", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({
      data: [twitchClip("a", 1000), twitchClip("b", DAY_MS / 2), twitchClip("c", DAY_MS - 1000)],
      cursor: undefined,
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns only in-range clips and cursor=undefined when GQL leaks an out-of-range clip past LAST_DAY", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({
      data: [
        twitchClip("recent-1", 1000),
        twitchClip("recent-2", DAY_MS / 2),
        twitchClip("leaked-old", DAY_MS + 60_000),
        twitchClip("leaked-older", 2 * DAY_MS),
      ],
      cursor: "gql-next",
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["recent-1", "recent-2"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns empty array and cursor=undefined when no Twitch clips are in range", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({
      data: [twitchClip("old-1", DAY_MS + 1000), twitchClip("old-2", 2 * DAY_MS)],
      cursor: "gql-next",
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.data).toEqual([]);
    expect(res.cursor).toBeUndefined();
  });

  it("applies a 7-day cutoff for Twitch timeRange='week' (mixed near the boundary)", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("fresh", 1000)] },
      LAST_WEEK: {
        data: [
          twitchClip("fresh", 1000),
          twitchClip("just-inside-7d", 7 * DAY_MS - 1000),
          twitchClip("just-outside-7d", 7 * DAY_MS + 1000),
          twitchClip("far-out", 14 * DAY_MS),
        ],
        cursor: "gql-next",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["fresh", "just-inside-7d"]);
    expect(res.cursor).toBe("gql-next");
  });

  it("returns all Twitch clips when every clip is inside the 7-day window", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("a", 1000)] },
      LAST_WEEK: {
        data: [twitchClip("a", 1000), twitchClip("b", 3 * DAY_MS), twitchClip("c", 6 * DAY_MS)],
        cursor: undefined,
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns no Twitch clips when everything is older than 7 days", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [] },
      LAST_WEEK: {
        data: [twitchClip("a", 7 * DAY_MS + 1000), twitchClip("b", 10 * DAY_MS)],
        cursor: "gql-next",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "week",
    });

    expect(res.data).toEqual([]);
    expect(res.cursor).toBe("gql-next");
  });

  it("applies a 30-day cutoff for Twitch timeRange='month' (mixed near the boundary)", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("fresh", 1000)] },
      LAST_WEEK: { data: [] },
      LAST_MONTH: {
        data: [
          twitchClip("fresh", 1000),
          twitchClip("just-inside-30d", 30 * DAY_MS - 1000),
          twitchClip("just-outside-30d", 30 * DAY_MS + 1000),
          twitchClip("far-out", 60 * DAY_MS),
        ],
        cursor: "gql-next",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["fresh", "just-inside-30d"]);
    expect(res.cursor).toBe("gql-next");
  });

  it("returns all Twitch clips when every clip is inside the 30-day window", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("a", 1000)] },
      LAST_WEEK: { data: [] },
      LAST_MONTH: {
        data: [twitchClip("a", 1000), twitchClip("b", 14 * DAY_MS), twitchClip("c", 29 * DAY_MS)],
        cursor: undefined,
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
  });

  it("returns no Twitch clips when everything is older than 30 days", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [] },
      LAST_WEEK: { data: [] },
      LAST_MONTH: {
        data: [twitchClip("a", 30 * DAY_MS + 1000), twitchClip("b", 100 * DAY_MS)],
        cursor: "gql-next",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "month",
    });

    expect(res.data).toEqual([]);
    expect(res.cursor).toBe("gql-next");
  });

  it("forwards the GQL cursor when the page fills the UI limit (returns all drained in-range items)", async () => {
    const items = Array.from({ length: 25 }, (_, i) => twitchClip(`c${i}`, 1000 * i));
    twitchGetClipsByChannelMock.mockResolvedValueOnce({ data: items, cursor: "gql-next" });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    // All 25 in-range clips from the page are returned (no mid-page trim).
    expect(res.data).toHaveLength(25);
    expect(res.cursor).toBe("gql-next");
  });

  it("requests upstream GQL pages with first=100 and the LAST_DAY filter on the strict-cutoff loop", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({
      data: [twitchClip("a", 1000), twitchClip("old", DAY_MS + 1000)],
      cursor: "gql-next",
    });

    await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_DAY" })
    );
  });

  it("sorts by viewCount within the in-range subset for sort=views + timeRange=day", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({
      data: [
        twitchClip("low", 1000, { viewCount: 5 }),
        twitchClip("high", DAY_MS / 2, { viewCount: 99 }),
        twitchClip("mid", DAY_MS - 1000, { viewCount: 42 }),
        twitchClip("out", DAY_MS + 1000, { viewCount: 9999 }),
      ],
      cursor: "gql-next",
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "views",
      timeRange: "day",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["high", "mid", "low"]);
    expect(res.cursor).toBeUndefined();
  });
});

describe("handleGetClipsByChannel - Twitch - All Time", () => {
  it("merges day/week/month buckets for All Time + Most Recent so today's clips appear first", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("one-minute", 60_000)] },
      LAST_WEEK: { data: [twitchClip("one-day", DAY_MS)] },
      LAST_MONTH: {
        data: [twitchClip("old", 100 * DAY_MS), twitchClip("one-day", DAY_MS)],
        cursor: "gql-abc",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(res.success).toBe(true);
    expect(res.data?.map((c) => c.id)).toEqual(["one-minute", "one-day", "old"]);
    expect(res.cursor).toBe("gql-abc");
    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_DAY" })
    );
    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_WEEK" })
    );
    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_MONTH" })
    );
  });

  it("overfetches before sorting All Time + Most Recent so low-view fresh clips are not hidden behind Twitch's upstream order", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: {
        data: [twitchClip("one-minute-low-view", 60_000, { viewCount: 10 })],
      },
      LAST_WEEK: {
        data: [
          twitchClip("popular-week-old", 7 * DAY_MS, { viewCount: 100_000 }),
          twitchClip("popular-day-old", DAY_MS, { viewCount: 50_000 }),
        ],
      },
      LAST_MONTH: {
        data: [
          twitchClip("popular-week-old", 7 * DAY_MS, { viewCount: 100_000 }),
          twitchClip("popular-day-old", DAY_MS, { viewCount: 50_000 }),
        ],
        cursor: "gql-abc",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 2,
      sort: "date",
      timeRange: "all",
    });

    expect(res.data?.map((c) => c.id)).toEqual([
      "one-minute-low-view",
      "popular-day-old",
      "popular-week-old",
    ]);
    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_DAY" })
    );
  });

  it("falls back to the all-time GQL pool when All Time + Most Recent has no recent clips", async () => {
    twitchGetClipsByChannelMock
      .mockResolvedValueOnce({ data: [], cursor: undefined })
      .mockResolvedValueOnce({ data: [], cursor: undefined })
      .mockResolvedValueOnce({ data: [], cursor: undefined })
      .mockResolvedValueOnce({
        data: [twitchClip("older", 100 * DAY_MS), twitchClip("less-old", 30 * DAY_MS)],
        cursor: "gql-abc",
      });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["less-old", "older"]);
    expect(res.cursor).toBe("gql-abc");
    expect(twitchGetClipsByChannelMock).toHaveBeenNthCalledWith(
      1,
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_DAY" })
    );
    expect(twitchGetClipsByChannelMock).toHaveBeenNthCalledWith(
      2,
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_WEEK" })
    );
    expect(twitchGetClipsByChannelMock).toHaveBeenNthCalledWith(
      3,
      "somechannel",
      expect.objectContaining({ first: 100, filter: "LAST_MONTH" })
    );
    expect(twitchGetClipsByChannelMock).toHaveBeenNthCalledWith(
      4,
      "somechannel",
      expect.objectContaining({ first: 100, filter: "ALL_TIME" })
    );
  });

  it("does not apply a cutoff and forwards the recent GQL cursor when timeRange='all'", async () => {
    mockTwitchClipBuckets({
      LAST_DAY: { data: [twitchClip("a", 1000)] },
      LAST_WEEK: { data: [] },
      LAST_MONTH: {
        data: [twitchClip("old", 100 * DAY_MS)],
        cursor: "gql-abc",
      },
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "date",
      timeRange: "all",
    });

    expect(res.data?.map((c) => c.id)).toEqual(["a", "old"]);
    expect(res.cursor).toBe("gql-abc");
  });

  it("uses the UI limit (not 100) and the ALL_TIME GQL filter for All Time + Views", async () => {
    twitchGetClipsByChannelMock.mockResolvedValueOnce({ data: [], cursor: undefined });

    await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 20,
      sort: "views",
      timeRange: "all",
    });

    expect(twitchGetClipsByChannelMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ first: 20, filter: "ALL_TIME" })
    );
  });
});

describe("handleGetClipsByChannel - Twitch - MAX_INTERNAL_PAGES safety cap", () => {
  it("stops after 5 upstream pages and keeps the GQL cursor when no out-of-range clip is seen", async () => {
    let pageIdx = 0;
    twitchGetClipsByChannelMock.mockImplementation(async () => {
      pageIdx++;
      return {
        data: Array.from({ length: 3 }, (_, i) => twitchClip(`p${pageIdx}-${i}`, 1000)),
        cursor: `gql-page-${pageIdx}`,
      };
    });

    const res = await handleGetClipsByChannel({
      platform: "twitch",
      channelName: "SomeChannel",
      limit: 1000,
      sort: "date",
      timeRange: "day",
    });

    expect(pageIdx).toBe(5);
    expect(res.data).toHaveLength(15);
    expect(res.cursor).toBe("gql-page-5");
  });
});

// ---------------------------------------------------------------------------
// IPC-handler surface (consolidated from tests/backend/ipc/handlers/video-handlers.test.ts in U20.c)
// Pins the wire contract for each channel + platform branch + error envelope.
// ---------------------------------------------------------------------------

const twitchResolverProto = vi.mocked(TwitchStreamResolver.prototype);
const kickResolverProto = vi.mocked(KickStreamResolver.prototype);

type Handler<Result> = (event: unknown, params: unknown) => Promise<Result>;
type DisplayVideo = {
  id: string;
  title: string;
  duration: string;
  views: string;
  platform: "kick" | "twitch";
  gameName?: string;
};
type VideoMetadata = {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string | null;
  views: number;
  duration: string;
  createdAt: string;
  thumbnailUrl: string;
  description: string;
  type: string;
  platform: string;
  shareUrl?: string;
};
type LivestreamVideo = {
  id: string;
  title: string;
  source: string;
  thumbnailUrl: string;
  duration: string;
  views: string;
  date: string;
  channelSlug: string;
  channelName: string;
  category: string;
  shareUrl?: string;
};
type VideoHandlerResults = {
  [IPC_CHANNELS.CLIPS_GET_BY_CATEGORY]: Awaited<
    ReturnType<Window["electronAPI"]["clips"]["getByCategory"]>
  >;
  [IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL]: Awaited<
    ReturnType<Window["electronAPI"]["clips"]["getPlaybackUrl"]>
  >;
  [IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY]: Awaited<
    ReturnType<Window["electronAPI"]["videos"]["getByCategory"]>
  >;
  [IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL]: PaginatedIpcResult<DisplayVideo[]>;
  [IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID]: IpcResult<LivestreamVideo>;
  [IPC_CHANNELS.VIDEOS_GET_METADATA]: IpcResult<VideoMetadata>;
  [IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL]: Awaited<
    ReturnType<Window["electronAPI"]["videos"]["getPlaybackUrl"]>
  >;
};

function getHandler<Channel extends keyof VideoHandlerResults>(
  channel: Channel
): Handler<VideoHandlerResults[Channel]> {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
}

function registerHandlers(): void {
  registerVideoHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
}

// Guards: Category media IPC delegates provider discovery to injected normalized readers.
describe("IPC handlers - category media ports", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    kickReadCategoryClipsMock.mockReset();
    kickReadCategoryVideosMock.mockReset();
    twitchReadCategoryClipsMock.mockReset();
    twitchReadCategoryVideosMock.mockReset();
    registerHandlers();
  });

  it("maps normalized Category Clips while preserving Desktop-only enrichment", async () => {
    twitchReadCategoryClipsMock.mockResolvedValue({
      kind: "available",
      data: [
        unifiedClip({
          categoryId: "509658",
          categoryName: "Just Chatting",
          gameId: "509658",
          gameName: "Just Chatting",
          language: "en",
          vodId: "video-1",
        }),
      ],
      cursor: "next-page",
    });

    const result = await getHandler(IPC_CHANNELS.CLIPS_GET_BY_CATEGORY)(
      {},
      {
        platform: "twitch",
        categoryId: "509658",
        categoryName: "Just Chatting",
        limit: 20,
        sort: "views",
        direction: "desc",
        timeRange: "all",
      }
    );

    expect(twitchReadCategoryClipsMock).toHaveBeenCalledWith(
      { id: "509658", name: "Just Chatting", slug: undefined },
      {
        limit: 20,
        cursor: undefined,
        sort: "popular",
        direction: "descending",
        language: undefined,
        timeRange: "all",
      }
    );
    expect(result).toEqual({
      success: true,
      availability: "available",
      data: [
        expect.objectContaining({
          id: "clip-1",
          platform: "twitch",
          channelName: "streamer",
          gameId: "509658",
          gameName: "Just Chatting",
          duration: "0:30",
          views: "42",
          language: "en",
          vodId: "video-1",
        }),
      ],
      cursor: "next-page",
    });
  });

  it("preserves typed unsupported and invalid availability", async () => {
    twitchReadCategoryClipsMock.mockResolvedValue({
      kind: "unsupported",
      reason: "Most Recent is unsupported",
    });
    kickReadCategoryClipsMock.mockResolvedValue({
      kind: "invalid",
      reason: "Kick Category Clips require a category slug",
    });
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_BY_CATEGORY);

    await expect(
      handler(
        {},
        {
          platform: "twitch",
          categoryId: "509658",
          sort: "date",
        }
      )
    ).resolves.toEqual({
      success: false,
      availability: "unsupported",
      errorCode: "unsupported",
      error: "Most Recent is unsupported",
    });
    await expect(
      handler(
        {},
        {
          platform: "kick",
          categoryId: "15",
          sort: "views",
        }
      )
    ).resolves.toEqual({
      success: false,
      availability: "unavailable",
      errorCode: "invalid-request",
      error: "Kick Category Clips require a category slug",
    });
  });

  it("maps normalized Category Videos and forwards sort, direction, and cursor", async () => {
    kickReadCategoryVideosMock.mockResolvedValue({
      kind: "available",
      data: [
        unifiedVideo({
          platform: "kick",
          categoryId: "15",
          categoryName: "Just Chatting",
          language: "en",
          source: "https://example.com/vod.m3u8",
          isSubOnly: true,
        }),
      ],
      cursor: "channels:next",
    });

    const result = await getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY)(
      {},
      {
        platform: "kick",
        categoryId: "15",
        categorySlug: "just-chatting",
        categoryName: "Just Chatting",
        limit: 12,
        cursor: "channels:current",
        sort: "date",
        direction: "asc",
        language: "en",
      }
    );

    expect(kickReadCategoryVideosMock).toHaveBeenCalledWith(
      { id: "15", name: "Just Chatting", slug: "just-chatting" },
      {
        limit: 12,
        cursor: "channels:current",
        sort: "recent",
        direction: "ascending",
        language: "en",
      }
    );
    expect(result).toEqual({
      success: true,
      availability: "available",
      data: [
        expect.objectContaining({
          gameId: "15",
          gameName: "Just Chatting",
          duration: "1:01:01",
          views: "5000",
          source: "https://example.com/vod.m3u8",
          isSubOnly: true,
        }),
      ],
      cursor: "channels:next",
    });
  });

  it("contains provider failures in the Category envelope", async () => {
    twitchReadCategoryVideosMock.mockRejectedValue(new Error("Twitch unavailable"));

    await expect(
      getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY)(
        {},
        { platform: "twitch", categoryId: "509658", sort: "views" }
      )
    ).resolves.toEqual({
      success: false,
      availability: "unavailable",
      errorCode: "upstream-error",
      error: "Twitch unavailable",
    });
  });
});

describe("IPC handlers - VIDEOS_GET_PLAYBACK_URL", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(logger.debug).mockReset();
    vi.mocked(logger.error).mockReset();
    vi.mocked(logger.info).mockReset();
    vi.mocked(logger.warn).mockReset();
    twitchResolverProto.getVodPlaybackUrl.mockReset();
    kickResolverProto.getVodPlaybackUrl.mockReset();
    registerHandlers();
  });

  it("resolves Twitch VOD playback URL", async () => {
    twitchResolverProto.getVodPlaybackUrl.mockResolvedValue({
      url: "https://vod.twitch.tv/test.m3u8",
      format: "hls",
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "twitch", videoId: "123" });

    expectSuccessful(result);
    expect(result.data.url).toBe("https://vod.twitch.tv/test.m3u8");
  });

  it("resolves Kick VOD playback URL", async () => {
    kickResolverProto.getVodPlaybackUrl.mockResolvedValue({
      url: "https://kick.com/vod.m3u8",
      format: "hls",
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", videoId: "456" });

    expectSuccessful(result);
    expect(result.data.url).toBe("https://kick.com/vod.m3u8");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "youtube", videoId: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported platform");
  });

  it("returns error on resolver failure", async () => {
    twitchResolverProto.getVodPlaybackUrl.mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "twitch", videoId: "bad" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });

  it("returns handled Kick VOD unavailability without logging an IPC error", async () => {
    kickResolverProto.getVodPlaybackUrl.mockRejectedValue(
      new Error(
        'Could not resolve VOD playback URL for "bad-id". Original error: Kick API error: 400'
      )
    );

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", videoId: "bad-id" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not resolve VOD playback URL");
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("IPC handlers - VIDEOS_GET_METADATA", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(twitchClient.getVideoById).mockReset();
    kickResolverProto.getVideoMetadata.mockReset();
    registerHandlers();
  });

  it("returns formatted Twitch video metadata", async () => {
    vi.mocked(twitchClient.getVideoById).mockResolvedValue(unifiedVideo());

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = await handler({}, { platform: "twitch", videoId: "v1" });

    expectSuccessful(result);
    expect(result.data.id).toBe("v1");
    expect(result.data.duration).toBe("1:01:01");
    expect(result.data.platform).toBe("twitch");
  });

  it("returns error when Twitch video not found", async () => {
    vi.mocked(twitchClient.getVideoById).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = await handler({}, { platform: "twitch", videoId: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Video not found");
  });

  it("returns Kick video metadata from resolver", async () => {
    const metadata = {
      id: "k1",
      title: "Kick VOD",
      channelId: "c1",
      channelName: "kickuser",
      channelDisplayName: "Kick User",
      channelAvatar: null,
      views: 10,
      duration: "1:00",
      createdAt: "2026-01-01T00:00:00Z",
      thumbnailUrl: "https://example.com/vod.jpg",
      platform: "kick" as const,
      category: "Just Chatting",
    };
    kickResolverProto.getVideoMetadata.mockResolvedValue(metadata);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = await handler({}, { platform: "kick", videoId: "k1" });

    expectSuccessful(result);
    expect(result.data).toBe(metadata);
  });

  it("returns an explicit error when Kick metadata is unavailable", async () => {
    kickResolverProto.getVideoMetadata.mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = await handler({}, { platform: "kick", videoId: "missing-kick-vod" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Video metadata unavailable");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_METADATA);
    const result = await handler({}, { platform: "youtube", videoId: "x" });

    expect(result.success).toBe(false);
  });
});

describe("IPC handlers - VIDEOS_GET_BY_CHANNEL", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(twitchClient.getVideosByChannel).mockReset();
    vi.mocked(twitchClient.getVideosGameData).mockReset();
    vi.mocked(kickClient.getVideos).mockReset();
    registerHandlers();
  });

  it("returns mapped Twitch videos with game data", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [unifiedVideo({ id: "v1", title: "Stream 1", duration: 7200, viewCount: 1000 })],
      cursor: "vc",
    });
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({
      v1: { id: "g1", name: "Valorant" },
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = await handler(
      {},
      {
        platform: "twitch",
        channelName: "TestChannel",
      }
    );

    expectSuccessful(result);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].duration).toBe("2:00:00");
    expect(result.data[0].gameName).toBe("Valorant");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.cursor).toBe("vc");
  });

  it("lowercases Twitch channel login for GQL", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [],
      cursor: undefined,
    });
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({});

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    await handler({}, { platform: "twitch", channelName: "MyCHANNEL" });

    expect(twitchClient.getVideosByChannel).toHaveBeenCalledWith("mychannel", expect.anything());
  });

  it("sorts Twitch videos by views when sort=views", async () => {
    vi.mocked(twitchClient.getVideosByChannel).mockResolvedValue({
      data: [
        unifiedVideo({ id: "v1", title: "A", duration: 60, viewCount: 10, thumbnailUrl: "" }),
        unifiedVideo({ id: "v2", title: "B", duration: 60, viewCount: 100, thumbnailUrl: "" }),
      ],
      cursor: undefined,
    });
    vi.mocked(twitchClient.getVideosGameData).mockResolvedValue({});

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = await handler(
      {},
      {
        platform: "twitch",
        channelName: "test",
        sort: "views",
      }
    );

    expectSuccessful(result);
    expect(result.data[0].id).toBe("v2");
  });

  it("returns Kick videos with client-side view sort", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [kickVideo({ id: "k1", views: "50" }), kickVideo({ id: "k2", views: "200" })],
      cursor: "kc",
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = await handler(
      {},
      {
        platform: "kick",
        channelName: "kickuser",
        sort: "views",
      }
    );

    expectSuccessful(result);
    expect(result.data[0].id).toBe("k2");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_CHANNEL);
    const result = await handler(
      {},
      {
        platform: "youtube",
        channelName: "test",
      }
    );

    expect(result.success).toBe(false);
  });
});

describe("IPC handlers - CLIPS_GET_PLAYBACK_URL", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    twitchResolverProto.getClipPlaybackUrl.mockReset();
    registerHandlers();
  });

  it("resolves Twitch clip playback URL via GQL", async () => {
    twitchResolverProto.getClipPlaybackUrl.mockResolvedValue({
      url: "https://clips.twitch.tv/test.mp4",
      format: "mp4",
    });

    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "twitch", clipId: "abc" });

    expectSuccessful(result);
    expect(result.data.url).toBe("https://clips.twitch.tv/test.mp4");
  });

  it("returns Kick clip URL directly with hls format for .m3u8", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = await handler(
      {},
      {
        platform: "kick",
        clipId: "k1",
        clipUrl: "https://kick.com/clip.m3u8",
      }
    );

    expectSuccessful(result);
    expect(result.data.url).toBe("https://kick.com/clip.m3u8");
    expect(result.data.format).toBe("hls");
  });

  it("returns Kick clip URL with mp4 format for non-.m3u8 URLs", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = await handler(
      {},
      {
        platform: "kick",
        clipId: "k1",
        clipUrl: "https://kick.com/clip.mp4",
      }
    );

    expectSuccessful(result);
    expect(result.data.format).toBe("mp4");
  });

  it("returns error when Kick clip has no clipUrl", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "kick", clipId: "k1" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clip URL required");
  });

  it("returns error for unsupported platform", async () => {
    const handler = getHandler(IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL);
    const result = await handler({}, { platform: "youtube", clipId: "x" });

    expect(result.success).toBe(false);
  });
});

describe("IPC handlers - VIDEOS_GET_BY_LIVESTREAM_ID", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(kickClient.getVideos).mockReset();
    registerHandlers();
  });

  it("finds matching VOD by livestream ID", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [
        kickVideo({ id: "v1", livestreamId: "999", title: "Wrong VOD" }),
        kickVideo({
          id: "v2",
          livestreamId: "123",
          title: "Correct VOD",
          source: "https://vod.m3u8",
        }),
      ],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "123",
      }
    );

    expectSuccessful(result);
    expect(result.data.id).toBe("v2");
    expect(result.data.title).toBe("Correct VOD");
  });

  it("paginates through multiple pages to find the VOD", async () => {
    vi.mocked(kickClient.getVideos)
      .mockResolvedValueOnce({
        data: [kickVideo({ id: "v1", livestreamId: "other", title: "Page 1" })],
        cursor: "page2",
      })
      .mockResolvedValueOnce({
        data: [
          kickVideo({
            id: "v2",
            livestreamId: "target",
            title: "Found",
            source: "https://vod.m3u8",
          }),
        ],
        cursor: undefined,
      });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "target",
      }
    );

    expectSuccessful(result);
    expect(result.data.id).toBe("v2");
    expect(kickClient.getVideos).toHaveBeenCalledTimes(2);
  });

  it("returns error when VOD not found after exhausting pages", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [kickVideo({ id: "v1", livestreamId: "other" })],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "nonexistent",
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("VOD not found");
  });

  it("stops after maxAttempts (5 pages) to prevent infinite loops", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [kickVideo({ id: "v1", livestreamId: "other" })],
      cursor: "next",
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "never-found",
      }
    );

    expect(result.success).toBe(false);
    expect(kickClient.getVideos).toHaveBeenCalledTimes(5);
  });

  it("returns error on API failure", async () => {
    vi.mocked(kickClient.getVideos).mockRejectedValue(new Error("network error"));

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "123",
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("network error");
  });

  it("matches live_stream_id field variant", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [
        kickVideo({
          id: "v1",
          live_stream_id: "123",
          title: "Matched",
          source: "https://vod.m3u8",
        }),
      ],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "123",
      }
    );

    expectSuccessful(result);
    expect(result.data.id).toBe("v1");
  });

  it("returns empty data for empty video pages", async () => {
    vi.mocked(kickClient.getVideos).mockResolvedValue({
      data: [],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.VIDEOS_GET_BY_LIVESTREAM_ID);
    const result = await handler(
      {},
      {
        channelSlug: "test",
        livestreamId: "123",
      }
    );

    expect(result.success).toBe(false);
  });
});
