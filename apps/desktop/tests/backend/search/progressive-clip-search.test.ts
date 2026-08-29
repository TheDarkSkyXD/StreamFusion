import { describe, expect, it, vi } from "vitest";

import type { UnifiedChannel, UnifiedClip } from "@shared/platform-types";
import { createProgressiveClipSearch } from "@backend/search/progressive-clip-search";

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

const clip = (id: string, owner: UnifiedChannel): UnifiedClip => ({
  id,
  platform: owner.platform,
  channelId: owner.id,
  channelName: owner.username,
  channelDisplayName: owner.displayName,
  channelAvatar: owner.avatarUrl,
  title: `Creator moment ${id}`,
  thumbnailUrl: "",
  clipUrl: `https://clips.twitch.tv/${id}`,
  embedUrl: `https://clips.twitch.tv/embed?clip=${id}`,
  duration: 30,
  viewCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  creatorName: "Curator",
});

const profile = { pageSize: 2, maxConcurrentRequests: 1 };

// Guards: focused clip search returns bounded resumable batches until every matched channel and provider cursor is exhausted.
// Guards: rate limits, repeated cursors, and cancellation cannot duplicate results or continue stale work.
describe("progressive Clip search", () => {
  it("returns bounded batches, then walks every Channel and Clip page without an age cutoff", async () => {
    const owners = [channel("1"), channel("2")];
    const channelCursors: Array<string | undefined> = [];
    const clipCursors = new Map<string, Array<string | undefined>>();
    const search = createProgressiveClipSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          channelCursors.push(options.cursor);
          return options.cursor
            ? { data: [owners[1]] }
            : { data: [owners[0]], cursor: "channels-2" };
        },
        fetchClips: async (owner, options) => {
          options.consumeRequest();
          const cursors = clipCursors.get(owner.id) ?? [];
          cursors.push(options.cursor);
          clipCursors.set(owner.id, cursors);
          return options.cursor
            ? { data: [clip(`${owner.id}-b`, owner)] }
            : { data: [clip(`${owner.id}-a`, owner)], cursor: `${owner.id}-clips-2` };
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
    expect(clipCursors).toEqual(
      new Map([
        ["1", [undefined, "1-clips-2"]],
        ["2", [undefined, "2-clips-2"]],
      ])
    );
    expect(result).toMatchObject({
      matchedChannelCount: 2,
      requestCount: 6,
      endReason: "exhausted",
    });
  });

  it("stops repeated provider cursors without duplicating Clips", async () => {
    const owner = channel("1");
    const searchChannels = vi.fn(async (_query, options) => {
      options.consumeRequest();
      return { data: [owner], cursor: "same-channels" };
    });
    const fetchClips = vi.fn(async (_owner, options) => {
      options.consumeRequest();
      return { data: [clip("same", owner)], cursor: "same-clips" };
    });
    const search = createProgressiveClipSearch({
      profile,
      source: { searchChannels, fetchClips },
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
    expect(fetchClips).toHaveBeenCalledTimes(2);
  });

  it("stops fan-out when the search session is cancelled", async () => {
    const controller = new AbortController();
    const owner = channel("1");
    const search = createProgressiveClipSearch({
      profile,
      source: {
        searchChannels: async (_query, options) => {
          options.consumeRequest();
          return { data: [owner] };
        },
        fetchClips: async (_owner, options) => {
          controller.abort();
          options.signal.throwIfAborted();
          return { data: [] };
        },
      },
    });

    await expect(
      search.next({
        sessionId: "cancel",
        platform: "twitch",
        query: "creator",
        limit: 1,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("surfaces rate limits with Retry-After and permits a fresh retry", async () => {
    const owner = channel("1");
    let attempts = 0;
    const search = createProgressiveClipSearch({
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
        fetchClips: async (_owner, options) => {
          options.consumeRequest();
          return { data: [clip("retry", owner)] };
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
    expect(retried.data.map((item) => item.id)).toEqual(["retry"]);
  });
});
