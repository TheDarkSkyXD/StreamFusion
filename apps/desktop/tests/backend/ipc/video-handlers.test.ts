import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getClips: vi.fn(),
    getVideos: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getClipsByChannel: vi.fn(),
  },
}));

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import {
  fillPageWithCutoff,
  getCutoffMs,
  handleGetClipsByChannel,
} from "@/backend/ipc/handlers/video-handlers";

const DAY_MS = 24 * 60 * 60 * 1000;
const FROZEN_NOW = new Date("2026-06-06T12:00:00.000Z").getTime();

const getClipsMock = vi.mocked(kickClient.getClips);
const getVideosMock = vi.mocked(kickClient.getVideos);

function clip(
  id: string,
  ageMs: number,
  extras: { views?: string | number; title?: string } = {}
): any {
  return {
    id,
    title: extras.title ?? `Clip ${id}`,
    duration: "0:30",
    views: extras.views ?? 1,
    date: new Date(FROZEN_NOW - ageMs).toLocaleDateString(),
    created_at: new Date(FROZEN_NOW - ageMs).toISOString(),
    thumbnailUrl: "",
    vodId: "",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  getClipsMock.mockReset();
  getVideosMock.mockReset();
  getVideosMock.mockResolvedValue({ data: [] });
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

  it("returns 'filled' and forwards the upstream cursor when limit is reached", async () => {
    const result = await fillPageWithCutoff<any>({
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
    expect(result.inRange.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).toBe("next-100");
    expect(result.pagesFetched).toBe(1);
  });

  it("stops on 'out-of-range' and returns cursor=undefined", async () => {
    const result = await fillPageWithCutoff<any>({
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
    const result = await fillPageWithCutoff<any>({
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
    const result = await fillPageWithCutoff<any>({
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
    const result = await fillPageWithCutoff<any>({
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
    const result = await fillPageWithCutoff<any>({
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

  it("walks multiple upstream pages to fill the limit", async () => {
    let page = 0;
    const result = await fillPageWithCutoff<any>({
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
    expect(result.inRange).toHaveLength(15);
    expect(result.reason).toBe("filled");
    expect(result.nextCursor).toBe("cursor-2");
  });
});

describe("handleGetClipsByChannel - Kick - strict cutoff", () => {
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
    expect(res.data?.map((c: any) => c.id)).toEqual(["a", "b", "c"]);
    expect(res.cursor).toBeUndefined();
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
    expect(res.data?.map((c: any) => c.id)).toEqual(["recent-1", "recent-2"]);
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

    expect(res.data?.map((c: any) => c.id)).toEqual(["fresh", "just-inside-7d"]);
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

    expect(res.data?.map((c: any) => c.id)).toEqual(["a", "b", "c"]);
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

    expect(res.data?.map((c: any) => c.id)).toEqual(["fresh", "just-inside-30d"]);
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

    expect(res.data?.map((c: any) => c.id)).toEqual(["a", "b", "c"]);
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

  it("forwards the upstream cursor when the page fills the UI limit", async () => {
    const items = Array.from({ length: 25 }, (_, i) => clip(`c${i}`, 1000 * i));
    getClipsMock.mockResolvedValueOnce({ data: items, cursor: "next-100" });

    const res = await handleGetClipsByChannel({
      platform: "kick",
      channelName: "somechannel",
      limit: 20,
      sort: "date",
      timeRange: "day",
    });

    expect(res.data).toHaveLength(20);
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

    expect(res.data?.map((c: any) => c.id)).toEqual(["a", "old"]);
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
    expect(res.data?.map((c: any) => c.id)).toEqual(["high", "mid", "low"]);
    expect(res.cursor).toBeUndefined();
    // Deep Fetch always asks for limit=100
    expect(getClipsMock).toHaveBeenCalledWith(
      "somechannel",
      expect.objectContaining({ limit: 100, sort: "date" })
    );
  });
});
