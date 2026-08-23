import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachePerformanceSamples,
  resetCachePerformanceSamples,
} from "@/hooks/queries/cache-performance";
import {
  getPersistedSearchPage,
  resetPersistedSearchLruForTests,
  savePersistedSearchPage,
} from "@/hooks/queries/persisted-search-lru";
import { useSearchVideos } from "@/hooks/queries/useSearch";
import type { Platform } from "@/shared/auth-types";
import type { SearchPlatformError, SearchVideosRequest } from "@/shared/search-types";
import { installElectronAPIMock } from "../../test-utils";

type BaseApi = ReturnType<typeof installElectronAPIMock>;
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function recentVideo(id: string, platform: Platform = "twitch") {
  return {
    id,
    platform,
    channelId: `${platform}-channel`,
    channelName: "streamer_university",
    channelDisplayName: "Streamer University",
    channelAvatar: "",
    title: "Streamer University lesson",
    thumbnailUrl: "",
    duration: 60,
    viewCount: 1,
    publishedAt: "2026-07-16T00:00:00.000Z",
    url:
      platform === "twitch" ? `https://www.twitch.tv/videos/${id}` : `https://kick.com/video/${id}`,
    type: "archive" as const,
  };
}

type VideoSearchResult = {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: Array<ReturnType<typeof recentVideo>>;
  cursor?: string;
  endReason?: string;
  retryAfterMs?: number;
  retryable: boolean;
  error?: SearchPlatformError | null;
  requestCount?: number;
  matchedChannelCount?: number;
};
type VideoSearchApi = BaseApi & {
  search: BaseApi["search"] & {
    videos: ReturnType<typeof vi.fn<(request: SearchVideosRequest) => Promise<VideoSearchResult>>>;
  };
};
let api: VideoSearchApi;

beforeEach(() => {
  const baseApi = installElectronAPIMock();
  api = Object.assign(baseApi, {
    search: Object.assign(baseApi.search, { videos: vi.fn() }),
    store: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
  });
  resetPersistedSearchLruForTests();
  resetCachePerformanceSamples();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSearchVideos", () => {
  it("starts Video fan-out only while active", async () => {
    api.search.videos = vi.fn(async (request) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [recentVideo(`${request.platform}-1`, request.platform)],
      endReason: "exhausted",
      retryable: false,
      requestCount: 2,
      matchedChannelCount: 1,
    }));
    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchVideos("streamer univer", undefined, 12, enabled),
      { initialProps: { enabled: false }, wrapper: wrapper() }
    );
    expect(api.search.videos).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(api.search.videos).toHaveBeenCalledTimes(2);
  });

  it("paints a warm persisted preview within 50ms without fan-out", async () => {
    await savePersistedSearchPage("videos", "streamer univer", undefined, 12, {
      pages: [{ data: [recentVideo("cached")], cursor: null }],
      pageParams: [undefined],
    });
    api.search.videos = vi.fn();
    const { result } = renderHook(() => useSearchVideos("streamer univer", undefined, 12, false), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["cached"]));
    expect(
      getCachePerformanceSamples("cache-hit-paint").find(
        (item) => item.surface === "search-videos-persisted"
      )?.withinBudget
    ).toBe(true);
    expect(api.search.videos).not.toHaveBeenCalled();
  });

  it("reconciles fresh empty, deletes persisted data, cancels, and does not resave on rerender", async () => {
    await savePersistedSearchPage("videos", "streamer univer", "twitch", 12, {
      pages: [{ data: [recentVideo("stale")], cursor: null }],
      pageParams: [undefined],
    });
    api.search.videos = vi.fn(async (request) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "exhausted",
      retryable: false,
      requestCount: 1,
      matchedChannelCount: 1,
    }));
    api.search.cancel = vi.fn(async () => ({ success: true, cancelled: true }));
    const { result, rerender, unmount } = renderHook(
      () => useSearchVideos("streamer univer", "twitch", 12, true),
      { wrapper: wrapper() }
    );
    expect(result.current.data.map((item) => item.id)).toEqual(["stale"]);
    await waitFor(() => expect(result.current.data).toEqual([]));
    await waitFor(() =>
      expect(getPersistedSearchPage("videos", "streamer univer", "twitch", 12)).toBeUndefined()
    );
    const writes = vi.mocked(api.store.set).mock.calls.length;
    rerender();
    await act(async () => Promise.resolve());
    expect(api.store.set).toHaveBeenCalledTimes(writes);
    unmount();
    await waitFor(() => expect(api.search.cancel).toHaveBeenCalledTimes(1));
  });

  it("keeps failed, limited, and cancelled statuses distinct", async () => {
    api.search.videos = vi.fn(async (request) =>
      request.platform === "twitch"
        ? {
            success: false,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [],
            retryable: true,
            error: { platform: request.platform, message: "down" },
            requestCount: 1,
            matchedChannelCount: 0,
          }
        : {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [],
            endReason: "safety-limit",
            retryable: false,
            requestCount: 2,
            matchedChannelCount: 1,
          }
    );
    const { result } = renderHook(() => useSearchVideos("streamer univer"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.platformStates.kick?.status).toBe("limited");
    expect(result.current.limitReached).toBe(true);

    api.search.videos = vi.fn(async (request) => ({
      success: false,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "cancelled",
      retryable: false,
      requestCount: 0,
      matchedChannelCount: 0,
    }));
    const cancelled = renderHook(() => useSearchVideos("other query", "twitch"), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(cancelled.result.current.platformStates.twitch?.status).toBe("cancelled")
    );
    expect(cancelled.result.current.isFinalEmpty).toBe(false);
    cancelled.unmount();

    api.search.videos = vi.fn(async (request) => ({
      success: request.platform === "kick",
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: request.platform === "twitch" ? "cancelled" : "exhausted",
      retryable: false,
      requestCount: 0,
      matchedChannelCount: 0,
    }));
    const mixed = renderHook(() => useSearchVideos("mixed cancellation"), { wrapper: wrapper() });
    await waitFor(() => expect(mixed.result.current.platformStates.kick?.status).toBe("exhausted"));
    expect(mixed.result.current.platformStates.twitch?.status).toBe("cancelled");
    expect(mixed.result.current.isFinalEmpty).toBe(false);
  });

  it("retries only the failed Platform after its advertised delay", async () => {
    let twitchCalls = 0;
    let kickCalls = 0;
    api.search.videos = vi.fn(async (request) => {
      if (request.platform === "kick") {
        kickCalls += 1;
        return {
          success: true,
          sessionId: request.sessionId,
          platform: request.platform,
          data: [recentVideo("healthy", "kick")],
          endReason: "exhausted",
          retryable: false,
          requestCount: 1,
          matchedChannelCount: 1,
        };
      }
      twitchCalls += 1;
      return twitchCalls === 1
        ? {
            success: false,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [],
            endReason: "rate-limited",
            retryAfterMs: 4_000,
            retryable: true,
            error: { platform: request.platform, message: "slow" },
            requestCount: 1,
            matchedChannelCount: 0,
          }
        : {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [],
            endReason: "exhausted",
            retryable: false,
            requestCount: 1,
            matchedChannelCount: 0,
          };
    });
    const { result } = renderHook(() => useSearchVideos("streamer univer"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.data.map((item) => item.id)).toEqual(["healthy"]);
    vi.useFakeTimers();
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retryPlatform("twitch");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(twitchCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await retry;
    });
    expect(twitchCalls).toBe(2);
    expect(kickCalls).toBe(1);
    expect(result.current.data.map((item) => item.id)).toEqual(["healthy"]);
  });

  it("ignores a late response from a superseded query", async () => {
    let resolveOld!: (value: VideoSearchResult) => void;
    const oldResponse = new Promise<VideoSearchResult>((resolve) => {
      resolveOld = resolve;
    });
    api.search.cancel = vi.fn(async () => ({ success: true, cancelled: true }));
    api.search.videos = vi.fn((request) =>
      request.query === "old query"
        ? oldResponse
        : Promise.resolve({
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [recentVideo("new")],
            endReason: "exhausted",
            retryable: false,
            requestCount: 2,
            matchedChannelCount: 1,
          })
    );
    const { result, rerender } = renderHook(({ query }) => useSearchVideos(query, "twitch"), {
      initialProps: { query: "old query" },
      wrapper: wrapper(),
    });
    await waitFor(() => expect(api.search.videos).toHaveBeenCalledTimes(1));
    rerender({ query: "new query" });
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["new"]));
    const oldRequest = api.search.videos.mock.calls[0][0];
    resolveOld({
      success: true,
      sessionId: oldRequest.sessionId,
      platform: "twitch",
      data: [recentVideo("old")],
      endReason: "exhausted",
      retryable: false,
      requestCount: 2,
      matchedChannelCount: 1,
    });
    await act(async () => Promise.resolve());
    expect(result.current.data.map((item) => item.id)).toEqual(["new"]);
    expect(api.search.cancel).toHaveBeenCalled();
  });

  it("deduplicates appended pages while loaded count grows", async () => {
    let page = 0;
    api.search.videos = vi.fn(async (request) => {
      page += 1;
      return page === 1
        ? {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [recentVideo("one")],
            cursor: "next",
            retryable: false,
            requestCount: 2,
            matchedChannelCount: 1,
          }
        : {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [recentVideo("one"), recentVideo("two")],
            endReason: "exhausted",
            retryable: false,
            requestCount: 3,
            matchedChannelCount: 1,
          };
    });
    const { result } = renderHook(() => useSearchVideos("streamer univer", "twitch"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["one"]));
    await act(async () => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["one", "two"]));
  });
});
