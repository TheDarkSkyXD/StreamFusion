import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachePerformanceSamples,
  resetCachePerformanceSamples,
} from "@/features/discovery/data/queries/cache-performance";
import {
  getPersistedSearchPage,
  resetPersistedSearchLruForTests,
  savePersistedSearchPage,
} from "@/features/discovery/data/queries/persisted-search-lru";
import { SEARCH_KEYS, useSearchClips } from "@/features/discovery/data/queries/useSearch";
import type { Platform } from "@shared/auth-types";
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

function recentClip(id: string, platform: Platform = "twitch") {
  return {
    id,
    platform,
    channelId: `${platform}-channel`,
    channelName: "streamer_university",
    channelDisplayName: "Streamer University",
    channelAvatar: "",
    title: "Streamer University moment",
    thumbnailUrl: "",
    clipUrl:
      platform === "twitch" ? `https://clips.twitch.tv/${id}` : `https://kick.com/clip/${id}`,
    embedUrl: `https://clips.example/${id}.mp4`,
    duration: 30,
    viewCount: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    creatorName: "Curator",
  };
}

type ClipSearchResult = Awaited<ReturnType<BaseApi["search"]["clips"]>>;
type ClipSearchApi = BaseApi & {
  search: BaseApi["search"] & {
    clips: ReturnType<typeof vi.fn<BaseApi["search"]["clips"]>>;
  };
};
let api: ClipSearchApi;

beforeEach(() => {
  const baseApi = installElectronAPIMock();
  api = Object.assign(baseApi, {
    search: Object.assign(baseApi.search, { clips: vi.fn() }),
    store: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
  });
  resetPersistedSearchLruForTests();
  resetCachePerformanceSamples();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSearchClips", () => {
  it("starts fan-out only while the Clips tab is active", async () => {
    api.search.clips = vi.fn(async (request) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [recentClip(`${request.platform}-1`, request.platform)],
      endReason: "exhausted",
      retryable: false,
      requestCount: 2,
      matchedChannelCount: 1,
    }));
    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchClips("streamer univer", undefined, 12, enabled),
      { initialProps: { enabled: false }, wrapper: wrapper() }
    );
    expect(api.search.clips).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(api.search.clips).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.store.set).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(api.store.set).toHaveBeenCalledTimes(1);
  });

  it("does not treat cancelled-only or cancelled-plus-exhausted Clips as final empty", async () => {
    api.search.clips = vi.fn(async (request) => ({
      success: false,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "cancelled",
      retryable: false,
      requestCount: 0,
      matchedChannelCount: 0,
    }));
    const cancelled = renderHook(() => useSearchClips("cancelled clips", "twitch"), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(cancelled.result.current.platformStates.twitch?.status).toBe("cancelled")
    );
    expect(cancelled.result.current.isFinalEmpty).toBe(false);
    cancelled.unmount();

    api.search.clips = vi.fn(async (request) => ({
      success: request.platform === "kick",
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: request.platform === "twitch" ? "cancelled" : "exhausted",
      retryable: false,
      requestCount: 0,
      matchedChannelCount: 0,
    }));
    const mixed = renderHook(() => useSearchClips("mixed cancellation"), { wrapper: wrapper() });
    await waitFor(() => expect(mixed.result.current.platformStates.kick?.status).toBe("exhausted"));
    expect(mixed.result.current.platformStates.twitch?.status).toBe("cancelled");
    expect(mixed.result.current.isFinalEmpty).toBe(false);
  });

  it("paints an exact persisted preview within 50ms without fan-out", async () => {
    await savePersistedSearchPage("clips", "streamer univer", undefined, 12, {
      pages: [{ data: [recentClip("cached")], cursor: null }],
      pageParams: [undefined],
    });
    api.search.clips = vi.fn();

    const { result } = renderHook(() => useSearchClips("streamer univer", undefined, 12, false), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["cached"]));
    expect(
      getCachePerformanceSamples("cache-hit-paint").find(
        (item) => item.surface === "search-clips-persisted"
      )?.withinBudget
    ).toBe(true);
    expect(api.search.clips).not.toHaveBeenCalled();
  });

  it("reconciles a fresh empty response and cancels the superseded session", async () => {
    await savePersistedSearchPage("clips", "streamer univer", "twitch", 12, {
      pages: [{ data: [recentClip("stale")], cursor: null }],
      pageParams: [undefined],
    });
    api.search.clips = vi.fn(async (request) => ({
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
    const { result, unmount } = renderHook(
      () => useSearchClips("streamer univer", "twitch", 12, true),
      { wrapper: wrapper() }
    );
    expect(result.current.data.map((item) => item.id)).toEqual(["stale"]);
    await waitFor(() => expect(result.current.data).toEqual([]));
    await waitFor(() =>
      expect(getPersistedSearchPage("clips", "streamer univer", "twitch", 12)).toBeUndefined()
    );
    unmount();
    await waitFor(() => expect(api.search.cancel).toHaveBeenCalledTimes(1));
  });

  it("retains warm Clips when a provider failure is not an authoritative fresh empty", async () => {
    await savePersistedSearchPage("clips", "streamer univer", "twitch", 12, {
      pages: [{ data: [recentClip("warm")], cursor: null }],
      pageParams: [undefined],
    });
    api.search.clips = vi.fn(async (request) => ({
      success: false,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      retryable: true,
      error: { platform: request.platform, message: "provider down" },
      requestCount: 1,
      matchedChannelCount: 0,
    }));

    const { result } = renderHook(() => useSearchClips("streamer univer", "twitch", 12, true), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.data.map((item) => item.id)).toEqual(["warm"]);
    expect(getPersistedSearchPage("clips", "streamer univer", "twitch", 12)).toBeDefined();
  });

  it("persists one same-ID metadata refresh and then settles", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } },
    });
    let title = "Original title";
    api.search.clips = vi.fn(async (request) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [{ ...recentClip("same"), title }],
      endReason: "exhausted",
      retryable: false,
      requestCount: 2,
      matchedChannelCount: 1,
    }));
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSearchClips("streamer univer", "twitch", 12, true), {
      wrapper: localWrapper,
    });
    await waitFor(() => expect(api.store.set).toHaveBeenCalledTimes(1));

    title = "Updated title";
    await act(async () => {
      await client.refetchQueries({
        queryKey: SEARCH_KEYS.clips("streamer univer", "twitch", 12),
      });
    });

    await waitFor(() => expect(result.current.data[0]?.title).toBe("Updated title"));
    await waitFor(() => expect(api.store.set).toHaveBeenCalledTimes(2));
    await act(async () => Promise.resolve());
    expect(api.store.set).toHaveBeenCalledTimes(2);
  });

  it("keeps the working Platform visible and retries only the rate-limited Platform", async () => {
    let twitchCalls = 0;
    let kickCalls = 0;
    api.search.clips = vi.fn(async (request) => {
      if (request.platform === "kick") {
        kickCalls += 1;
        return {
          success: true,
          sessionId: request.sessionId,
          platform: request.platform,
          data: [recentClip("healthy", "kick")],
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
    const { result } = renderHook(() => useSearchClips("streamer univer"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.data.map((item) => item.id)).toEqual(["healthy"]);
    vi.useFakeTimers();
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retryPlatform("twitch");
    });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    await act(async () => retry);
    expect(twitchCalls).toBe(2);
    expect(kickCalls).toBe(1);
  });

  it("deduplicates appended pages and reports limited separately from exhausted", async () => {
    let page = 0;
    api.search.clips = vi.fn(async (request) => {
      page += 1;
      return page === 1
        ? {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [recentClip("one")],
            cursor: "next",
            retryable: false,
            requestCount: 2,
            matchedChannelCount: 1,
          }
        : {
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [recentClip("one"), recentClip("two")],
            endReason: "safety-limit",
            retryable: false,
            requestCount: 3,
            matchedChannelCount: 1,
          };
    });
    const { result } = renderHook(() => useSearchClips("streamer univer", "twitch"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["one"]));
    await act(async () => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["one", "two"]));
    expect(result.current.limitReached).toBe(true);
  });
});
