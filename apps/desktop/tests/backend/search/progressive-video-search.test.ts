import { describe, expect, it, vi } from "vitest";

import type { UnifiedChannel, UnifiedVideo } from "@shared/platform-types";
import { createProgressiveVideoSearch } from "@backend/search/progressive-video-search";

const channel = (id: string): UnifiedChannel => ({
  id,
  platform: "twitch",
  username: `creator_${id}`,
  displayName: `Creator ${id}`,
  avatarUrl: "",
  isLive: false,
  isVerified: false,
  isPartner: false,
});

const video = (id: string, owner: UnifiedChannel): UnifiedVideo => ({
  id,
  platform: owner.platform,
  channelId: owner.id,
  channelName: owner.username,
  channelDisplayName: owner.displayName,
  channelAvatar: owner.avatarUrl,
  title: `Creator lesson ${id}`,
  thumbnailUrl: "",
  duration: 60,
  viewCount: 1,
  publishedAt: "2026-07-16T00:00:00.000Z",
  url: `https://www.twitch.tv/videos/${id}`,
  type: "archive",
});

const profile = { pageSize: 2, maxConcurrentRequests: 1 };

// Guards: focused VOD search returns bounded resumable batches until every matched channel and provider cursor is exhausted.
// Guards: provider failures, rate limits, repeated cursors, malformed data, and cancellation cannot duplicate or strand results.
describe("progressive Video search", () => {
  it("returns bounded batches, then walks every Channel and Video page to exhaustion", async () => {
    const owners = [channel("1"), channel("2")];
    const channelCursors: Array<string | undefined> = [];
    const videoCursors = new Map<string, Array<string | undefined>>();
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          channelCursors.push(options.cursor);
          return options.cursor
            ? { data: [owners[1]] }
            : { data: [owners[0]], cursor: "channels-2" };
        },
        fetchVideos: async (owner, options) => {
          options.consumeRequest();
          const cursors = videoCursors.get(owner.id) ?? [];
          cursors.push(options.cursor);
          videoCursors.set(owner.id, cursors);
          return options.cursor
            ? { data: [video(`${owner.id}-b`, owner)] }
            : { data: [video(`${owner.id}-a`, owner)], cursor: `${owner.id}-videos-2` };
        },
      },
    });

    const firstPage = await search.next({
      sessionId: "exhaustive",
      platform: "twitch",
      query: "creator",
      limit: 10,
    });
    const pages = [firstPage];
    while (pages.at(-1)?.cursor) {
      pages.push(
        await search.next({
          sessionId: "exhaustive",
          platform: "twitch",
          query: "creator",
          limit: 10,
          cursor: pages.at(-1)?.cursor,
        })
      );
    }
    const result = pages.at(-1)!;

    expect(firstPage.data.map((item) => item.id)).toEqual(["1-a"]);
    expect(pages.flatMap((page) => page.data).map((item) => item.id)).toEqual([
      "1-a",
      "1-b",
      "2-a",
      "2-b",
    ]);
    expect(channelCursors).toEqual([undefined, "channels-2"]);
    expect(videoCursors).toEqual(
      new Map([
        ["1", [undefined, "1-videos-2"]],
        ["2", [undefined, "2-videos-2"]],
      ])
    );
    expect(result).toMatchObject({
      matchedChannelCount: 2,
      requestCount: 6,
      endReason: "exhausted",
    });
  });

  it("stops repeated provider cursors without duplicating results", async () => {
    const owner = channel("1");
    const searchChannels = vi.fn(async (_query, options) => {
      options.consumeRequest();
      return { data: [owner], cursor: "same-channels" };
    });
    const fetchVideos = vi.fn(async (_owner, options) => {
      options.consumeRequest();
      return { data: [video("same", owner)], cursor: "same-videos" };
    });
    const search = createProgressiveVideoSearch({
      profile,
      source: { searchChannels, fetchVideos },
    });

    const pages = [
      await search.next({
        sessionId: "repeated",
        platform: "twitch",
        query: "creator",
        limit: 10,
      }),
    ];
    while (pages.at(-1)?.cursor) {
      pages.push(
        await search.next({
          sessionId: "repeated",
          platform: "twitch",
          query: "creator",
          limit: 10,
          cursor: pages.at(-1)?.cursor,
        })
      );
    }

    expect(pages.flatMap((page) => page.data).map((item) => item.id)).toEqual(["same"]);
    expect(searchChannels).toHaveBeenCalledTimes(2);
    expect(fetchVideos).toHaveBeenCalledTimes(2);
    expect(pages.at(-1)?.endReason).toBe("exhausted");
  });

  it("can retry after an ordinary provider failure", async () => {
    const owner = channel("1");
    let attempts = 0;
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          attempts += 1;
          if (attempts === 1) throw new Error("provider down");
          return { data: [owner] };
        },
        fetchVideos: async (_owner, options) => {
          options.consumeRequest();
          return { data: [video("retry-success", owner)] };
        },
      },
    });

    await expect(
      search.next({ sessionId: "retry", platform: "twitch", query: "creator", limit: 1 })
    ).rejects.toThrow("provider down");
    const result = await search.next({
      sessionId: "retry",
      platform: "twitch",
      query: "creator",
      limit: 1,
    });
    expect(result.data.map((item) => item.id)).toEqual(["retry-success"]);
    expect(result.requestCount).toBe(2);
  });

  it("surfaces Retry-After and starts a fresh attempt on retry", async () => {
    const owner = channel("1");
    let attempts = 0;
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 4_000 });
          }
          return { data: [owner] };
        },
        fetchVideos: async (_owner, options) => {
          options.consumeRequest();
          return { data: [video("after-rate-limit", owner)] };
        },
      },
    });

    await expect(
      search.next({ sessionId: "rate", platform: "twitch", query: "creator", limit: 1 })
    ).resolves.toMatchObject({ endReason: "rate-limited", retryAfterMs: 4_000 });
    const retried = await search.next({
      sessionId: "rate",
      platform: "twitch",
      query: "creator",
      limit: 1,
    });
    expect(retried.data.map((item) => item.id)).toEqual(["after-rate-limit"]);
  });

  it("reports a rate limit even when the provider omits Retry-After", async () => {
    let attempts = 0;
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("slow down"), { status: 429 });
          return { data: [] };
        },
        fetchVideos: vi.fn(),
      },
    });

    await expect(
      search.next({ sessionId: "rate-no-delay", platform: "twitch", query: "creator", limit: 1 })
    ).resolves.toMatchObject({ endReason: "rate-limited", retryAfterMs: undefined });
  });

  it("does not strand sibling lanes when one concurrent provider request fails", async () => {
    const owners = [channel("1"), channel("2")];
    let failed = false;
    const search = createProgressiveVideoSearch({
      profile: { pageSize: 2, maxConcurrentRequests: 2 },
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          return { data: owners };
        },
        fetchVideos: async (owner, options) => {
          options.consumeRequest();
          if (owner.id === "1" && !failed) {
            failed = true;
            throw new Error("temporary failure");
          }
          return { data: [video(`video-${owner.id}`, owner)] };
        },
      },
    });

    await expect(
      search.next({ sessionId: "lane-retry", platform: "twitch", query: "creator", limit: 4 })
    ).rejects.toThrow("temporary failure");
    const retried = await search.next({
      sessionId: "lane-retry",
      platform: "twitch",
      query: "creator",
      limit: 4,
    });
    expect(retried.data.map((item) => item.id)).toEqual(["video-1", "video-2"]);
  });

  it("stops fan-out when the session is cancelled", async () => {
    const controller = new AbortController();
    const owner = channel("1");
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          return { data: [owner] };
        },
        fetchVideos: async (_owner, options) => {
          controller.abort();
          options.signal.throwIfAborted();
          return { data: [] };
        },
      },
    });

    await expect(
      search.next({
        sessionId: "cancelled",
        platform: "twitch",
        query: "creator",
        limit: 2,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("deduplicates provider pages, excludes malformed Videos, and drains output pages", async () => {
    const owner = channel("1");
    const first = video("a", owner);
    const second = video("b", owner);
    const search = createProgressiveVideoSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          return { data: [owner] };
        },
        fetchVideos: async (_owner, options) => {
          options.consumeRequest();
          return {
            data: options.cursor ? [first, second, { ...second, id: "" }] : [first],
            cursor: options.cursor ? undefined : "videos-2",
          };
        },
      },
    });

    const pageOne = await search.next({
      sessionId: "pages",
      platform: "twitch",
      query: "creator",
      limit: 1,
    });
    const pageTwo = await search.next({
      sessionId: "pages",
      platform: "twitch",
      query: "creator",
      limit: 1,
      cursor: pageOne.cursor,
    });
    expect(pageOne.data.map((item) => item.id)).toEqual(["a"]);
    expect(pageTwo.data.map((item) => item.id)).toEqual(["b"]);
    expect(pageTwo.endReason).toBe("exhausted");
  });
});
