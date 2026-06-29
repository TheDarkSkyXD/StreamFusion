import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachePerformanceSamples,
  resetCachePerformanceSamples,
} from "@/hooks/queries/cache-performance";
import {
  CATEGORY_KEYS,
  useCategoryById,
  useCategoryMetadata,
  useTopCategories,
  useUnifiedCategoryLink,
} from "@/hooks/queries/useCategories";
import { CHANNEL_KEYS, useChannelByUsername, useFollowedChannels } from "@/hooks/queries/useChannels";
import {
  FOLLOWED_CONTENT_KEYS,
  type FollowedContentItem,
  useFollowedClipPlayback,
  useFollowedClips,
  useFollowedVideos,
} from "@/hooks/queries/useFollowedContent";
import { useHistoryQuery } from "@/hooks/queries/useHistoryQuery";
import { useInfiniteStreamsByCategory } from "@/hooks/queries/useInfiniteStreams";
import {
  SEARCH_KEYS,
  useSearchAll,
  useSearchCategories,
  useSearchChannels,
} from "@/hooks/queries/useSearch";
import {
  STREAM_KEYS,
  useFollowedStreams,
  useStreamByChannel,
  useTopStreams,
} from "@/hooks/queries/useStreams";
import { normalizeCategoryName } from "@/lib/utils";
import { useHistoryStore } from "@/store/history-store";

import { fixtures, installElectronAPIMock } from "../../test-utils";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, refetchOnWindowFocus: false, retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function seedQuery(client: QueryClient, queryKey: QueryKey, data: unknown): void {
  client.setQueryData(queryKey, data);
}

function seedInfiniteQuery(client: QueryClient, queryKey: QueryKey, page: unknown): void {
  client.setQueryData(queryKey, {
    pageParams: [undefined],
    pages: [page],
  });
}

const stream = fixtures.stream();
const channel = fixtures.channel();
const category = fixtures.category();
const followedContentChannel = fixtures.channel({
  id: "followed-channel-1",
  username: "followedchannel",
});
const followedContentItem: FollowedContentItem = {
  id: "content-1",
  title: "Cached followed item",
  duration: "00:10:00",
  views: "10",
  date: "2026-06-28T12:00:00.000Z",
  thumbnailUrl: "https://example.com/content.jpg",
  channelSlug: "followedchannel",
  channelName: "Followed Channel",
  platform: "twitch",
};

interface CacheHitCase {
  name: string;
  render: () => void;
  seed: (client: QueryClient) => void;
  surface: string;
}

function cacheHitCases(): CacheHitCase[] {
  const followedChannels = [followedContentChannel];
  const clip: FollowedContentItem = {
    ...followedContentItem,
    id: "clip-1",
    embedUrl: "https://clips.twitch.tv/embed/clip-1",
    url: "https://clips.twitch.tv/clip-1",
  };
  const infiniteCategoryKey = [
    ...STREAM_KEYS.byCategory("cat-1", "twitch"),
    "infinite",
    "Just Chatting",
    "en",
  ] as const;

  return [
    {
      name: "top streams",
      surface: "stream-list",
      seed: (client) => seedQuery(client, STREAM_KEYS.top("twitch", 20), [stream]),
      render: () => useTopStreams("twitch", 20),
    },
    {
      name: "followed stream status",
      surface: "following",
      seed: (client) => seedQuery(client, STREAM_KEYS.followed("twitch"), [stream]),
      render: () => useFollowedStreams("twitch", 20, { enabled: true }),
    },
    {
      name: "stream by channel",
      surface: "stream-detail",
      seed: (client) => seedQuery(client, STREAM_KEYS.byChannel("testchannel", "twitch"), stream),
      render: () => useStreamByChannel("testchannel", "twitch"),
    },
    {
      name: "search channels",
      surface: "search",
      seed: (client) =>
        seedInfiniteQuery(client, SEARCH_KEYS.channels("xqc", undefined, 50), {
          cursor: null,
          data: [channel],
        }),
      render: () => useSearchChannels(" xqc "),
    },
    {
      name: "search categories",
      surface: "search",
      seed: (client) =>
        seedInfiniteQuery(client, SEARCH_KEYS.categories("fortnite", undefined, 20), {
          cursor: null,
          data: [category],
        }),
      render: () => useSearchCategories("fortnite"),
    },
    {
      name: "combined search",
      surface: "search",
      seed: (client) =>
        seedQuery(client, SEARCH_KEYS.everything("test", undefined, 5), {
          categories: [category],
          channels: [channel],
          clips: [],
          streams: [stream],
          videos: [],
        }),
      render: () => useSearchAll("test"),
    },
    {
      name: "top categories",
      surface: "categories",
      seed: (client) => seedQuery(client, CATEGORY_KEYS.top("twitch"), [category]),
      render: () => useTopCategories("twitch"),
    },
    {
      name: "category by id",
      surface: "category-detail",
      seed: (client) => seedQuery(client, CATEGORY_KEYS.byId("cat-1", "twitch"), category),
      render: () => useCategoryById("cat-1", "twitch"),
    },
    {
      name: "category metadata",
      surface: "category-detail",
      seed: (client) =>
        seedQuery(client, CATEGORY_KEYS.metadata("cat-1", "twitch"), { tags: ["irl"] }),
      render: () => useCategoryMetadata(category),
    },
    {
      name: "unified category link fallback",
      surface: "category-detail",
      seed: (client) =>
        seedQuery(client, ["category-match", normalizeCategoryName("Just Chatting"), "kick"], {
          ...category,
          id: "kick-cat-1",
          platform: "kick",
        }),
      render: () => useUnifiedCategoryLink("twitch", "cat-1", "Just Chatting"),
    },
    {
      name: "infinite category streams",
      surface: "category-detail",
      seed: (client) =>
        seedInfiniteQuery(client, infiniteCategoryKey, {
          data: [stream],
          nextCursor: undefined,
        }),
      render: () => useInfiniteStreamsByCategory("cat-1", "twitch", 20, "Just Chatting", "en"),
    },
    {
      name: "followed channels",
      surface: "following",
      seed: (client) => seedQuery(client, CHANNEL_KEYS.followed("twitch"), [channel]),
      render: () => useFollowedChannels("twitch", { enabled: true }),
    },
    {
      name: "channel by username",
      surface: "stream-detail",
      seed: (client) => seedQuery(client, CHANNEL_KEYS.byUsername("testchannel", "twitch"), channel),
      render: () => useChannelByUsername("testchannel", "twitch"),
    },
    {
      name: "followed videos",
      surface: "following",
      seed: (client) =>
        seedQuery(client, FOLLOWED_CONTENT_KEYS.videos(followedChannels, 4, "recent"), [
          followedContentItem,
        ]),
      render: () => useFollowedVideos(followedChannels),
    },
    {
      name: "followed clips",
      surface: "following",
      seed: (client) =>
        seedQuery(client, FOLLOWED_CONTENT_KEYS.clips(followedChannels, 4, "recent", "all"), [
          followedContentItem,
        ]),
      render: () => useFollowedClips(followedChannels),
    },
    {
      name: "followed clip playback",
      surface: "following",
      seed: (client) =>
        seedQuery(client, FOLLOWED_CONTENT_KEYS.clipPlayback(clip), {
          qualities: [{ quality: "source", url: "https://example.com/clip.m3u8" }],
          url: "https://example.com/clip.m3u8",
        }),
      render: () => useFollowedClipPlayback(clip),
    },
    {
      name: "watch history",
      surface: "history",
      seed: () =>
        useHistoryStore.setState({
          history: [
            {
              id: "kick-video-v1",
              originalId: "v1",
              title: "Cached history item",
              thumbnail: "https://example.com/history.jpg",
              platform: "kick",
              type: "video",
              channelName: "xqc",
              timestamp: Date.now(),
            },
          ],
        }),
      render: () => useHistoryQuery(),
    },
  ];
}

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
  resetCachePerformanceSamples();
  useHistoryStore.setState({ history: [] });
});

afterEach(() => {
  resetCachePerformanceSamples();
  vi.restoreAllMocks();
});

// Guards: every query-backed app data surface must report cached data reaching React within the 50ms cache-hit paint budget.
// Guards: cache-hit telemetry is grouped by user-facing surface so slow cached paints identify whether search, following, categories, stream detail, or stream lists need work.
describe("cache performance telemetry across app data hooks", () => {
  it.each(cacheHitCases())("records cache-hit paint for $name data", async (testCase) => {
    const client = makeClient();
    testCase.seed(client);

    renderHook(testCase.render, { wrapper: makeWrapper(client) });

    await waitFor(() => {
      expect(getCachePerformanceSamples("cache-hit-paint")).toEqual([
        expect.objectContaining({
          surface: testCase.surface,
          withinBudget: true,
        }),
      ]);
    });

    const [sample] = getCachePerformanceSamples("cache-hit-paint");
    expect(sample.durationMs).toBeLessThanOrEqual(50);
    expect(api.streams.getTop).not.toHaveBeenCalled();
  });

  it("covers every cached page/component data surface in the app-data cache matrix", () => {
    expect(new Set(cacheHitCases().map((testCase) => testCase.surface))).toEqual(
      new Set([
        "categories",
        "category-detail",
        "following",
        "history",
        "search",
        "stream-detail",
        "stream-list",
      ])
    );
  });
});
