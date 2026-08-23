import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchStreams } from "@/hooks/queries/useSearch";
import type { Platform } from "@/shared/auth-types";
import { fixtures, installElectronAPIMock } from "../../test-utils";

interface StreamSearchRequest {
  sessionId: string;
  platform: Platform;
  [key: string]: unknown;
}

type BaseApi = ReturnType<typeof installElectronAPIMock>;
type SearchStreamsMock = ReturnType<
  typeof vi.fn<(request: StreamSearchRequest) => Promise<unknown>>
>;
type SearchTestApi = Omit<BaseApi, "search"> & {
  search: BaseApi["search"] & { streams: SearchStreamsMock };
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

let api: SearchTestApi;

beforeEach(() => {
  const baseApi = installElectronAPIMock();
  api = {
    ...baseApi,
    search: Object.assign(baseApi.search, { streams: vi.fn() as SearchStreamsMock }),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSearchStreams", () => {
  it("includes Live Only in the progressive Stream request identity", async () => {
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "exhausted",
      retryable: false,
      scannedPages: 1,
      requestCount: 2,
    }));
    renderHook(() => useSearchStreams("streamer univer", "twitch", 20, true, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(1));
    expect(api.search.streams).toHaveBeenCalledWith(expect.objectContaining({ liveOnly: true }));
  });

  it("does not treat cancelled-only or cancelled-plus-exhausted Streams as final empty", async () => {
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => ({
      success: false,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "cancelled",
      retryable: false,
      scannedPages: 0,
      requestCount: 0,
    }));
    const cancelled = renderHook(() => useSearchStreams("cancelled streams", "twitch", 20, true), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(cancelled.result.current.platformStates.twitch?.status).toBe("cancelled")
    );
    expect(cancelled.result.current.isFinalEmpty).toBe(false);
    cancelled.unmount();

    api.search.streams = vi.fn(async (request: StreamSearchRequest) => ({
      success: request.platform === "kick",
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: request.platform === "twitch" ? "cancelled" : "exhausted",
      retryable: false,
      scannedPages: 0,
      requestCount: 0,
    }));
    const mixed = renderHook(() => useSearchStreams("mixed cancellation"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(mixed.result.current.platformStates.kick?.status).toBe("exhausted"));
    expect(mixed.result.current.platformStates.twitch?.status).toBe("cancelled");
    expect(mixed.result.current.isFinalEmpty).toBe(false);
  });

  it("starts a fresh session for query, Platform, tab, and Live Only changes", async () => {
    api.search.cancel = vi.fn(async () => ({ success: true, cancelled: true }));
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: [],
      endReason: "exhausted",
      retryable: false,
      scannedPages: 1,
      requestCount: 2,
    }));
    const { rerender } = renderHook(
      ({ query, platform, enabled, liveOnly }) =>
        useSearchStreams(query, platform, 20, enabled, liveOnly),
      {
        initialProps: {
          query: "streamer",
          platform: undefined as Platform | undefined,
          enabled: true,
          liveOnly: false,
        },
        wrapper: wrapper(),
      }
    );
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(2));
    rerender({ query: "university", platform: "twitch", enabled: true, liveOnly: false });
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(3));
    rerender({ query: "university", platform: "twitch", enabled: true, liveOnly: true });
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(4));
    rerender({ query: "university", platform: "twitch", enabled: false, liveOnly: true });
    await waitFor(() => expect(api.search.cancel).toHaveBeenCalledTimes(3));
    rerender({ query: "university", platform: "twitch", enabled: true, liveOnly: true });
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(5));
    expect(
      new Set(vi.mocked(api.search.streams).mock.calls.map(([request]) => request.sessionId)).size
    ).toBe(4);
  });

  // Guards: tab activation reuses completed rows while a new session refreshes them.
  it("keeps a completed Stream cache visible during an off-on background refresh", async () => {
    const warm = fixtures.stream({ id: "warm", title: "Warm stream" });
    const fresh = fixtures.stream({ id: "fresh", title: "Fresh stream" });
    let resolveRefresh!: (value: unknown) => void;
    let calls = 0;
    api.search.streams = vi.fn((request: StreamSearchRequest) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          success: true,
          sessionId: request.sessionId,
          platform: request.platform,
          data: [warm],
          endReason: "exhausted",
          retryable: false,
        });
      }
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchStreams("streamer univer", "twitch", 20, enabled),
      { initialProps: { enabled: true }, wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.data).toEqual([warm]));

    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual([warm]);
    expect(result.current.isLoading).toBe(false);

    const refreshRequest = vi.mocked(api.search.streams).mock.calls[1][0];
    resolveRefresh({
      success: true,
      sessionId: refreshRequest.sessionId,
      platform: refreshRequest.platform,
      data: [fresh],
      endReason: "exhausted",
      retryable: false,
    });
    await waitFor(() => expect(result.current.data).toEqual([fresh]));
  });

  it("retains a dedicated cached Stream when its background refresh fails", async () => {
    const warm = fixtures.stream({ id: "warm-failure", title: "Warm failure fallback" });
    let calls = 0;
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => {
      calls += 1;
      return {
        success: calls === 1,
        sessionId: request.sessionId,
        platform: request.platform,
        data: calls === 1 ? [warm] : [],
        endReason: calls === 1 ? "exhausted" : "rate-limited",
        retryable: calls > 1,
        error: calls > 1 ? { platform: request.platform, message: "Unavailable" } : null,
      };
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchStreams("warm failure", "twitch", 20, enabled),
      { initialProps: { enabled: true }, wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.data).toEqual([warm]));

    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.data).toEqual([warm]);
    expect(result.current.isFinalEmpty).toBe(false);
  });

  // Guards: cancelling a same-intent tab session prevents its late response replacing the new one.
  it("ignores a late same-key Stream response after a rapid off-on activation", async () => {
    const current = fixtures.stream({ id: "current", title: "Current stream" });
    let resolveOld!: (value: unknown) => void;
    let call = 0;
    api.search.streams = vi.fn((request: StreamSearchRequest) => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve({
        success: true,
        sessionId: request.sessionId,
        platform: request.platform,
        data: [current],
        endReason: "exhausted",
        retryable: false,
      });
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useSearchStreams("streamer univer", "twitch", 20, enabled),
      { initialProps: { enabled: true }, wrapper: wrapper() }
    );
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(1));
    const oldRequest = vi.mocked(api.search.streams).mock.calls[0][0];

    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual([current]));

    resolveOld({
      success: true,
      sessionId: oldRequest.sessionId,
      platform: oldRequest.platform,
      data: [fixtures.stream({ id: "late", title: "Late stream" })],
      endReason: "exhausted",
      retryable: false,
    });
    await waitFor(() => expect(result.current.data).toEqual([current]));
  });

  it("ignores a late page from a superseded query", async () => {
    let resolveOld!: (value: unknown) => void;
    const current = fixtures.stream({ id: "current-stream", title: "Current stream" });
    api.search.streams = vi.fn((request: StreamSearchRequest) =>
      request.query === "old query"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            success: true,
            sessionId: request.sessionId,
            platform: request.platform,
            data: [current],
            endReason: "exhausted",
            retryable: false,
            scannedPages: 1,
            requestCount: 2,
          })
    );
    const { result, rerender } = renderHook(
      ({ query }) => useSearchStreams(query, "twitch", 20, true, false),
      { initialProps: { query: "old query" }, wrapper: wrapper() }
    );
    await waitFor(() => expect(api.search.streams).toHaveBeenCalledTimes(1));
    const oldSessionId = vi.mocked(api.search.streams).mock.calls[0][0].sessionId;
    rerender({ query: "current query" });
    await waitFor(() => expect(result.current.data).toEqual([current]));
    resolveOld({
      success: true,
      sessionId: oldSessionId,
      platform: "twitch",
      data: [fixtures.stream({ id: "late-stream" })],
      endReason: "exhausted",
      retryable: false,
      scannedPages: 1,
      requestCount: 2,
    });
    await waitFor(() => expect(result.current.data).toEqual([current]));
  });

  it("appends the next page from the Platform that still has a cursor", async () => {
    const first = fixtures.stream({ id: "stream-1" });
    const second = fixtures.stream({ id: "stream-2" });
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => ({
      success: true,
      sessionId: request.sessionId,
      platform: request.platform,
      data: request.cursor ? [second] : [first],
      cursor: request.cursor ? undefined : "next-page",
      endReason: request.cursor ? "exhausted" : undefined,
      retryable: false,
      scannedPages: request.cursor ? 2 : 1,
      requestCount: request.cursor ? 3 : 2,
    }));
    const { result } = renderHook(() => useSearchStreams("streamer univer", "twitch", 20, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data.map((item) => item.id)).toEqual(["stream-1"]));
    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.data.map((item) => item.id)).toEqual(["stream-1", "stream-2"])
    );
  });

  it("retries only the rate-limited Platform after Retry-After", async () => {
    const kickStream = fixtures.stream({ id: "kick-ok", platform: "kick" });
    let twitchAttempts = 0;
    api.search.streams = vi.fn(async (request: StreamSearchRequest) => {
      if (request.platform === "kick")
        return {
          success: true,
          sessionId: request.sessionId,
          platform: "kick",
          data: [kickStream],
          endReason: "exhausted",
          retryable: false,
          scannedPages: 1,
          requestCount: 2,
        };
      twitchAttempts += 1;
      return {
        success: twitchAttempts > 1,
        sessionId: request.sessionId,
        platform: "twitch",
        data: [],
        endReason: twitchAttempts > 1 ? "exhausted" : "rate-limited",
        retryAfterMs: twitchAttempts === 1 ? 4_000 : undefined,
        retryable: twitchAttempts === 1,
        error:
          twitchAttempts === 1
            ? { platform: "twitch", code: "429", message: "rate limited" }
            : null,
        scannedPages: 1,
        requestCount: 2,
      };
    });
    const { result } = renderHook(() => useSearchStreams("streamer univer"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.platformStates.twitch?.status).toBe("failed"));
    expect(result.current.data).toEqual([kickStream]);
    vi.useFakeTimers();
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retryPlatform("twitch");
    });
    await act(async () => vi.advanceTimersByTimeAsync(3_999));
    expect(api.search.streams).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await retry;
    });
    expect(result.current.data).toEqual([kickStream]);
  });
});
