import assert from "node:assert/strict";
import test from "node:test";

import {
  createProgressiveDiscovery,
  normalizeSearchQuery,
  rankAndDeduplicateCategories,
  rankAndDeduplicateStreams,
  rankSearchChannels,
  sanitizeSearchResultCollection,
  settleDiscoveryProviders,
  validateSearchIntent,
} from "@streamfusion/core/discovery";
import { contentFixtures as content } from "@streamfusion/core/testing";

test("search intent validation normalizes portable input and reports every invalid field", () => {
  assert.deepEqual(
    validateSearchIntent({
      query: "  Café  café 🎮 ",
      platform: "kick",
      resultType: "channels",
      liveOnly: true,
      limits: { resultLimit: 20 },
    }),
    {
      kind: "valid",
      intent: {
        query: "cafe 🎮",
        platform: "kick",
        resultType: "channels",
        liveOnly: true,
        limits: { resultLimit: 20 },
      },
    },
  );
  assert.deepEqual(validateSearchIntent({}).issues, [
    "empty-query",
    "invalid-result-type",
    "invalid-result-limit",
    "invalid-live-only",
  ]);
  assert.equal(normalizeSearchQuery("  Pokémon---POKEMON  "), "pokemon");
});

test("search result validation rejects provider and presentation leakage", () => {
  const result = sanitizeSearchResultCollection({
    channels: [content.channel, { ...content.channel, chatroomId: 12 }],
    categories: [content.category],
    streams: [content.stream],
    videos: [content.video],
    clips: [content.clip],
  });
  assert.deepEqual(result.data.channels, [content.channel]);
  assert.equal(result.rejectedChannels, 1);
  assert.equal(result.rejectedCategories, 0);
  assert.equal(result.rejectedStreams, 0);
  assert.equal(result.rejectedVideos, 0);
  assert.equal(result.rejectedClips, 0);
});

test("ranking is deterministic and deduplicates only within a Platform identity", () => {
  const exact = { ...content.channel, id: "exact", username: "cafe" };
  const popularDuplicate = {
    ...exact,
    displayName: "Café",
    followerCount: 5_000,
  };
  const twitchPeer = {
    ...exact,
    platform: "twitch",
    id: "exact",
    followerCount: 2_000,
  };
  const prefix = {
    ...content.channel,
    id: "prefix",
    username: "cafeteria",
    displayName: "Cafeteria",
    followerCount: 50_000,
  };
  const ranked = rankSearchChannels(
    [prefix, exact, twitchPeer, popularDuplicate],
    "cafe",
  );
  assert.deepEqual(
    ranked.map(
      (channel) => `${channel.platform}:${channel.id}:${channel.followerCount}`,
    ),
    ["kick:exact:5000", "twitch:exact:2000", "kick:prefix:50000"],
  );

  const categories = rankAndDeduplicateCategories(
    [
      content.category,
      { ...content.category, viewerCount: 2_000 },
      { ...content.category, platform: "twitch", id: "category-1" },
    ],
    "just chatting",
  );
  assert.equal(categories.length, 2);
  assert.equal(categories[0].viewerCount, 2_000);
});

test("Stream ranking removes offline and repeated results before popularity sorting", () => {
  const ranked = rankAndDeduplicateStreams(
    [
      content.stream,
      { ...content.stream, viewerCount: 99 },
      { ...content.stream, id: "offline", isLive: false, viewerCount: 1_000 },
      { ...content.stream, id: "second", viewerCount: 50 },
    ],
    "streamer",
  );
  assert.deepEqual(
    ranked.map((stream) => stream.id),
    ["second", "stream-1"],
  );
});

test("provider settlement preserves partial data and isolates complete failure", () => {
  assert.deepEqual(
    settleDiscoveryProviders({
      requestedPlatforms: ["twitch", "kick"],
      outcomes: [
        {
          platform: "twitch",
          status: "complete",
          data: [{ id: "low", viewers: 10 }],
        },
        {
          platform: "kick",
          status: "partial",
          data: [{ id: "high", viewers: 20 }],
        },
      ],
      limit: 1,
      compare: (left, right) => right.viewers - left.viewers,
    }),
    {
      success: true,
      data: [{ id: "high", viewers: 20 }],
      providers: { twitch: "complete", kick: "partial" },
    },
  );
  assert.deepEqual(
    settleDiscoveryProviders({
      requestedPlatforms: ["kick"],
      outcomes: [
        {
          platform: "kick",
          status: "failed",
          data: [],
          error: "offline",
        },
      ],
    }),
    {
      success: false,
      error: "offline",
      platform: "kick",
      providers: { kick: "failed" },
    },
  );
});

test("progressive discovery paginates, ranks, deduplicates, and stops repeated cursors", async () => {
  const pages = [
    {
      kind: "success",
      items: [
        { id: "one", score: 1 },
        { id: "two", score: 2 },
      ],
      cursor: "next",
    },
    {
      kind: "success",
      items: [
        { id: "two", score: 20 },
        { id: "three", score: 3 },
      ],
      cursor: "next",
    },
  ];
  const search = createProgressiveDiscovery({
    source: {
      async loadPage() {
        const page = pages.shift();
        assert.ok(page);
        return page;
      },
    },
    profile: { pageSize: 20, maxPages: 5, maxRequests: 5 },
    identify: (item) => item.id,
    rank: (items) => [...items].sort((left, right) => right.score - left.score),
  });

  const first = await search.next({
    sessionId: "session",
    scope: "twitch",
    query: "stream",
    limit: 1,
  });
  assert.deepEqual(first.data, [{ id: "two", score: 2 }]);
  assert.equal(first.endReason, undefined);

  const second = await search.next({
    sessionId: "session",
    scope: "twitch",
    query: "stream",
    limit: 5,
    cursor: first.cursor,
  });
  assert.deepEqual(second.data, [{ id: "one", score: 1 }]);
  assert.equal(second.endReason, undefined);

  const third = await search.next({
    sessionId: "session",
    scope: "twitch",
    query: "stream",
    limit: 5,
    cursor: second.cursor,
  });
  assert.deepEqual(third.data, [{ id: "three", score: 3 }]);
  assert.equal(third.endReason, "repeated-cursor");
  assert.equal(third.scannedPages, 2);
  assert.equal(third.requestCount, 2);
});

test("progressive discovery contains rate limits, cancellation, and unsafe budgets", async () => {
  const rateLimited = createProgressiveDiscovery({
    source: {
      async loadPage() {
        return { kind: "rate-limited", items: [], retryAfterMs: 1_000 };
      },
    },
    profile: { pageSize: 10, maxPages: 2, maxRequests: 2 },
    identify: (item) => item.id,
    rank: (items) => items,
  });
  const result = await rateLimited.next({
    sessionId: "session",
    scope: "kick",
    query: "stream",
    limit: 10,
  });
  assert.equal(result.endReason, "rate-limited");
  assert.equal(result.retryAfterMs, 1_000);

  const cancelled = await rateLimited.next({
    sessionId: "cancelled",
    scope: "kick",
    query: "stream",
    limit: 10,
    signal: { aborted: true },
  });
  assert.equal(cancelled.endReason, "cancelled");

  assert.throws(
    () =>
      createProgressiveDiscovery({
        source: {
          async loadPage() {
            return { kind: "success", items: [] };
          },
        },
        profile: { pageSize: 0, maxPages: 1, maxRequests: 1 },
        identify: (item) => item.id,
        rank: (items) => items,
      }),
    /positive integers/,
  );
});

test("progressive discovery contains thrown provider errors and cancellation during a request", async () => {
  const providerError = new Error("provider unavailable");
  const failed = createProgressiveDiscovery({
    source: {
      async loadPage() {
        throw providerError;
      },
    },
    profile: { pageSize: 10, maxPages: 2, maxRequests: 2 },
    identify: (item) => item.id,
    rank: (items) => items,
  });
  const failure = await failed.next({
    sessionId: "failed",
    scope: "kick",
    query: "stream",
    limit: 10,
  });
  assert.equal(failure.kind, "failure");
  assert.equal(failure.error, providerError);
  assert.equal(failure.scannedPages, 1);
  assert.equal(failure.requestCount, 1);

  const signal = { aborted: false };
  const cancelled = createProgressiveDiscovery({
    source: {
      async loadPage() {
        signal.aborted = true;
        return { kind: "success", items: [{ id: "late" }] };
      },
    },
    profile: { pageSize: 10, maxPages: 2, maxRequests: 2 },
    identify: (item) => item.id,
    rank: (items) => items,
  });
  const result = await cancelled.next({
    sessionId: "cancelled-in-flight",
    scope: "twitch",
    query: "stream",
    limit: 10,
    signal,
  });
  assert.equal(result.kind, "success");
  assert.deepEqual(result.data, []);
  assert.equal(result.endReason, "cancelled");
});
