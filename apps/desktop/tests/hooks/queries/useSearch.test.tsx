import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEARCH_KEYS,
  type SearchAllResponse,
  useSearchAll,
  useSearchCategories,
  useSearchChannels,
} from "@/hooks/queries/useSearch";
import { hydratePersistedBrowseSnapshots } from "@/hooks/queries/browse-snapshot-bootstrap";
import {
  resetPersistedSearchResultsLruForTests,
  savePersistedSearchResult,
} from "@/hooks/queries/persisted-search-results-lru";
import { fixtures, installElectronAPIMock } from "../../test-utils";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function createProductionQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnMount: false,
        staleTime: 30_000,
      },
    },
  });
}

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  resetPersistedSearchResultsLruForTests();
  api = installElectronAPIMock();
  api.search.channels = vi.fn(async () => ({ data: [], error: null, cursor: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Guards: useSearchChannels and useSearchCategories treat an empty data page as end-of-list even when the backend still returns a cursor — defends against the Twitch-GQL hasNextPage-stuck-true skeleton-flicker loop in the dropdown
// Guards: search hooks stay idle on empty queries — the omnibox must not fan out IPC on every keystroke before debouncing kicks in
// Guards: typeahead hides previous-query rows while a new query is pending so stale channels cannot be selected.
describe("useSearchChannels", () => {
  it("fetches channel search results", async () => {
    const ch = fixtures.channel({ username: "xqc" });
    api.search.channels = vi.fn(async () => ({ data: [ch], error: null, cursor: null }));

    const { result } = renderHook(() => useSearchChannels("xqc"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages[0].data).toHaveLength(1);
    expect(result.current.data!.pages[0].data[0].username).toBe("xqc");
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(() => useSearchChannels(""), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("fetches one-character channel queries", async () => {
    const ch = fixtures.channel({ username: "a" });
    api.search.channels = vi.fn(async () => ({ data: [ch], error: null, cursor: null }));

    const { result } = renderHook(() => useSearchChannels("x"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search.channels).toHaveBeenCalledWith({
      query: "x",
      platform: undefined,
      limit: 50,
      after: undefined,
    });
  });

  it("reuses fresh cached channel results on remount", async () => {
    const wrapper = makeWrapper();
    const ch = fixtures.channel({ username: "xqc" });
    api.search.channels = vi.fn(async () => ({ data: [ch], error: null, cursor: null }));

    const first = renderHook(() => useSearchChannels("xqc"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useSearchChannels(" xqc "), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.search.channels).toHaveBeenCalledTimes(1);
  });

  it("clears prior suggestions while a different query is pending", async () => {
    const ch = fixtures.channel({ username: "first" });
    let resolveSecond!: (value: { data: (typeof ch)[]; error: null; cursor: null }) => void;
    const secondRequest = new Promise<{ data: (typeof ch)[]; error: null; cursor: null }>(
      (resolve) => {
        resolveSecond = resolve;
      }
    );
    api.search.channels = vi.fn(({ query }) =>
      query === "first" ? Promise.resolve({ data: [ch], error: null, cursor: null }) : secondRequest
    );

    const { result, rerender } = renderHook(({ query }) => useSearchChannels(query), {
      initialProps: { query: "first" },
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ query: "second" });
    await waitFor(() => expect(api.search.channels).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();

    resolveSecond({ data: [fixtures.channel({ username: "second" })], error: null, cursor: null });
    await waitFor(() => expect(result.current.data?.pages[0].data[0].username).toBe("second"));
  });

  it("treats empty data page as end-of-list (no next page)", async () => {
    api.search.channels = vi.fn(async () => ({
      data: [],
      error: null,
      cursor: "some-cursor",
    }));
    const { result } = renderHook(() => useSearchChannels("ghost"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useSearchCategories", () => {
  it("fetches category search results", async () => {
    const cat = fixtures.category({ name: "Fortnite" });
    api.categories.search = vi.fn(async () => ({ data: [cat], error: null, cursor: null }));

    const { result } = renderHook(() => useSearchCategories("fortnite"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages[0].data).toHaveLength(1);
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(() => useSearchCategories(""), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

// Guards: submitted search publishes a useful provider result before broad cross-platform hydration finishes.
// Guards: replacing a submitted query cancels the stale broad backend request.
// Guards: cold search emits deterministic request, first-useful, and full-hydration timing stages.
// Guards: progressive cross-platform channels preserve relevance ordering as providers settle.
// Guards: broad hydration marks completed empty quick providers so the backend does not repeat their channel discovery.
// Guards: a rejected quick provider stays unseeded so broad discovery retries it, and its failed broad result is not persisted.
// Guards: React StrictMode effect replay emits one request-start trace per logical search request.
// Guards: submitted search never presents previous-key results as the next query's cold response.
// Guards: exact normalized submitted-search results survive restart, paint within 50ms, and revalidate once without blocking on either provider
// Guards: warm submitted search skips duplicate quick channel IPC and starts one broad refresh that performs current provider discovery
// Guards: broad search responses without provider completion metadata cannot replace or persist the last exact result
// Guards: structured Search timings distinguish cache publication from accepted current remote hydration and count every useful result type
// Guards: a superseded submitted search cannot persist after entering a delayed cache-hydration queue
// Guards: a broad response rejected by durable cache admission cannot be reported as full hydration.
describe("useSearchAll", () => {
  it("publishes an exact persisted result immediately after restart while refresh remains pending", async () => {
    const cachedChannel = fixtures.channel({
      id: "restart-search",
      username: "restartsearch",
      displayName: "Restart Search",
      platform: "twitch",
    });
    const payload: SearchAllResponse = {
      channels: [cachedChannel],
      categories: [],
      streams: [],
      videos: [],
      clips: [],
    };
    const persistedValues = new Map<string, unknown>();
    api.store.get = vi.fn(async (key: string) => persistedValues.get(key) ?? null);
    api.store.set = vi.fn(async (key: string, value: unknown) => {
      persistedValues.set(key, value);
    });
    api.search.all = vi.fn(async () => ({
      data: payload,
      error: null,
      providers: { twitch: "complete", kick: "complete" },
    }));

    const first = renderHook(() => useSearchAll(" Restart Search "), { wrapper: makeWrapper() });
    await waitFor(() => expect(first.result.current.data).toEqual(payload));
    await waitFor(() => expect(api.store.set).toHaveBeenCalledWith("search-results-lru:v1", expect.anything()));
    first.unmount();

    const restartedClient = createQueryClient();
    resetPersistedSearchResultsLruForTests();
    const startedAt = performance.now();
    await hydratePersistedBrowseSnapshots(restartedClient);
    const never = new Promise<never>(() => undefined);
    api.search.channels = vi.fn(() => never);
    api.search.all = vi.fn(() => never);

    const restarted = renderHook(() => useSearchAll("restart   search"), {
      wrapper: makeWrapper(restartedClient),
    });
    const bootstrapToPublicationMs = performance.now() - startedAt;

    expect(restarted.result.current.data).toEqual(payload);
    expect(bootstrapToPublicationMs).toBeLessThan(50);
    expect(api.search.channels).not.toHaveBeenCalled();
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    restarted.unmount();
  });

  it("starts one broad refresh for a stale bootstrap under production query defaults", async () => {
    const cachedChannel = fixtures.channel({
      id: "production-bootstrap-search",
      username: "productionsearch",
      displayName: "Production Search",
      platform: "twitch",
    });
    const cached: SearchAllResponse = {
      channels: [cachedChannel],
      categories: [],
      streams: [],
      videos: [],
      clips: [],
    };
    api.store.get = vi.fn(async (key: string) =>
      key === "search-results-lru:v1"
        ? {
            version: 1,
            entries: [
              {
                query: "production search",
                limit: 5,
                savedAt: Date.now(),
                data: cached,
              },
            ],
          }
        : null
    );
    resetPersistedSearchResultsLruForTests();
    const client = createProductionQueryClient();
    await hydratePersistedBrowseSnapshots(client);
    api.logs.write = vi.fn();
    api.search.channels = vi.fn(() => new Promise<never>(() => undefined));
    api.search.all = vi.fn(() => new Promise<never>(() => undefined));

    const mounted = renderHook(() => useSearchAll("production search"), {
      wrapper: makeWrapper(client),
      reactStrictMode: true,
    });

    expect(mounted.result.current.data).toEqual(cached);
    expect(api.search.channels).not.toHaveBeenCalled();
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    const requestStarts = api.logs.write.mock.calls.filter(
      (call: Array<{ meta?: { stage?: string } }>) => call[0]?.meta?.stage === "request-start"
    );
    expect(requestStarts).toHaveLength(1);
    mounted.unmount();
  });

  it("revalidates cached channels with one broad refresh and no duplicate quick searches", async () => {
    const cachedChannel = fixtures.channel({
      id: "cached-channel",
      username: "warmchannels",
      displayName: "Warm Channels",
      platform: "twitch",
    });
    const refreshedChannel = fixtures.channel({
      id: "refreshed-channel",
      username: "warmchannels",
      displayName: "Warm Channels Refreshed",
      platform: "twitch",
    });
    const cached: SearchAllResponse = {
      channels: [cachedChannel], categories: [], streams: [], videos: [], clips: [],
    };
    const persistedValues = new Map<string, unknown>();
    api.store.get = vi.fn(async (key: string) => persistedValues.get(key) ?? null);
    api.store.set = vi.fn(async (key: string, value: unknown) => {
      persistedValues.set(key, value);
    });
    await savePersistedSearchResult("warm channels", undefined, 5, cached);
    resetPersistedSearchResultsLruForTests();
    const client = createQueryClient();
    await hydratePersistedBrowseSnapshots(client);
    expect(client.getQueryData(SEARCH_KEYS.everything("warm channels", undefined, 5))).toEqual(cached);
    const quick = deferred<{ data: (typeof refreshedChannel)[]; error: null; cursor: null }>();
    const broad = deferred<{
      success: true;
      data: SearchAllResponse;
      providers: { twitch: "complete"; kick: "complete" };
    }>();
    api.search.channels = vi.fn(() => quick.promise);
    api.search.all = vi.fn(() => broad.promise);

    const { result } = renderHook(() => useSearchAll("warm channels"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(cached));
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    expect(api.search.channels).not.toHaveBeenCalled();
    expect(api.search.all).toHaveBeenCalledWith(
      expect.objectContaining({ channelSeeds: [], channelSeedPlatforms: [] })
    );

    broad.resolve({
      success: true,
      data: {
        channels: [refreshedChannel], categories: [], streams: [], videos: [], clips: [],
      },
      providers: { twitch: "complete", kick: "complete" },
    });
    await waitFor(() => expect(result.current.data?.channels).toEqual([refreshedChannel]));
  });

  it("keeps an exact persisted result when one provider refresh fails", async () => {
    const cachedChannel = fixtures.channel({
      id: "last-good-search",
      username: "partialsearch",
      platform: "twitch",
    });
    const partialChannel = fixtures.channel({
      id: "partial-search",
      username: "partial",
      platform: "kick",
    });
    const cached: SearchAllResponse = {
      channels: [cachedChannel], categories: [], streams: [], videos: [], clips: [],
    };
    api.store.get = vi.fn(async () => null);
    await savePersistedSearchResult("partial search", undefined, 5, cached);
    vi.mocked(api.store.set).mockClear();
    api.search.channels = vi.fn(async () => ({ data: [partialChannel], error: null, cursor: null }));
    api.search.all = vi.fn(async () => ({
      data: { channels: [partialChannel], categories: [], streams: [], videos: [], clips: [] },
      error: null,
      providers: { twitch: "failed", kick: "complete" },
    }));

    const { result } = renderHook(() => useSearchAll("partial   search"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(result.current.data).toEqual(cached);
    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("keeps an exact persisted result when provider completion metadata is absent", async () => {
    const cachedChannel = fixtures.channel({
      id: "cached-no-status",
      username: "nostatus",
      platform: "twitch",
    });
    const untrustedChannel = fixtures.channel({
      id: "untrusted-no-status",
      username: "nostatus",
      platform: "twitch",
    });
    const cached: SearchAllResponse = {
      channels: [cachedChannel], categories: [], streams: [], videos: [], clips: [],
    };
    api.store.get = vi.fn(async () => null);
    await savePersistedSearchResult("no status", undefined, 5, cached);
    vi.mocked(api.store.set).mockClear();
    api.search.channels = vi.fn(() => new Promise<never>(() => undefined));
    api.search.all = vi.fn(async () => ({
      success: true,
      data: {
        channels: [untrustedChannel], categories: [], streams: [], videos: [], clips: [],
      },
    }));

    const { result } = renderHook(() => useSearchAll("no status"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(result.current.data).toEqual(cached);
    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("does not persist a completed response after its query is superseded", async () => {
    const storeRead = deferred<null>();
    const never = new Promise<never>(() => undefined);
    const firstPayload: SearchAllResponse = {
      channels: [fixtures.channel({ username: "first", displayName: "First" })],
      categories: [], streams: [], videos: [], clips: [],
    };
    api.store.get = vi.fn(() => storeRead.promise);
    api.search.all = vi.fn(({ query }) =>
      query === "first"
        ? Promise.resolve({
            data: firstPayload,
            error: null,
            providers: { twitch: "complete", kick: "complete" },
          })
        : never
    );

    const { rerender } = renderHook(({ query }) => useSearchAll(query), {
      initialProps: { query: "first" },
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(api.store.get).toHaveBeenCalledWith("search-results-lru:v1"));
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender({ query: "second" });
    await act(async () => storeRead.resolve(null));
    await act(async () => Promise.resolve());

    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("publishes a ready Twitch channel while Kick and broad hydration are still pending", async () => {
    const twitchChannel = fixtures.channel({
      platform: "twitch",
      username: "xqc",
      displayName: "xQc",
      isLive: true,
    });
    const never = new Promise<never>(() => undefined);
    api.search.channels = vi.fn(({ platform }) =>
      platform === "twitch"
        ? Promise.resolve({ data: [twitchChannel], error: null, cursor: null })
        : never
    );
    api.search.all = vi.fn(() => never);

    const { result } = renderHook(() => useSearchAll("xqc"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data?.channels).toEqual([twitchChannel]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isHydrating).toBe(true);
  });

  it("passes the completed quick channels into broad hydration instead of requesting them again", async () => {
    const twitchChannel = fixtures.channel({ platform: "twitch", username: "xqc" });
    const kickChannel = fixtures.channel({
      id: "kick-xqc",
      platform: "kick",
      username: "xqc",
    });
    api.search.channels = vi.fn(async ({ platform }) => ({
      data: platform === "twitch" ? [twitchChannel] : [kickChannel],
      error: null,
      cursor: null,
    }));
    api.search.all = vi.fn(async () => ({
      data: { channels: [], categories: [], streams: [], videos: [], clips: [] },
      error: null,
    }));

    const { result } = renderHook(() => useSearchAll("xqc"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search.all).toHaveBeenCalledWith(
      expect.objectContaining({
        channelSeeds: [twitchChannel, kickChannel],
        channelSeedPlatforms: ["twitch", "kick"],
      })
    );
  });

  it("marks completed empty quick providers as seeded for broad hydration", async () => {
    api.search.channels = vi.fn(async () => ({ data: [], error: null, cursor: null }));
    api.search.all = vi.fn(async () => ({
      data: { channels: [], categories: [], streams: [], videos: [], clips: [] },
      error: null,
    }));

    const { result } = renderHook(() => useSearchAll("missing"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search.all).toHaveBeenCalledWith(
      expect.objectContaining({
        channelSeeds: [],
        channelSeedPlatforms: ["twitch", "kick"],
      })
    );
  });

  it("retries a rejected quick provider in broad discovery without persisting its partial result", async () => {
    const kickChannel = fixtures.channel({
      id: "kick-only-quick-result",
      platform: "kick",
      username: "partialquick",
    });
    api.search.channels = vi.fn(({ platform }) =>
      platform === "twitch"
        ? Promise.reject(new Error("Twitch quick lookup failed"))
        : Promise.resolve({ data: [kickChannel], error: null, cursor: null })
    );
    const broad = deferred<{
      success: true;
      data: SearchAllResponse;
      providers: { twitch: "failed"; kick: "complete" };
    }>();
    api.search.all = vi.fn(() => broad.promise);

    const { result } = renderHook(() => useSearchAll("partial quick"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    expect(api.search.all).toHaveBeenCalledWith(
      expect.objectContaining({
        channelSeeds: [kickChannel],
        channelSeedPlatforms: ["kick"],
      })
    );
    broad.resolve({
      success: true,
      data: { channels: [kickChannel], categories: [], streams: [], videos: [], clips: [] },
      providers: { twitch: "failed", kick: "complete" },
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data?.channels).toEqual([kickChannel]);
    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("cancels stale broad backend work when the submitted query changes", async () => {
    const never = new Promise<never>(() => undefined);
    api.search.cancel = vi.fn(async () => ({ success: true, cancelled: true }));
    api.search.all = vi.fn(({ query }) =>
      query === "xqc"
        ? never
        : Promise.resolve({
            data: { channels: [], categories: [], streams: [], videos: [], clips: [] },
            error: null,
          })
    );

    const { rerender } = renderHook(({ query }) => useSearchAll(query), {
      initialProps: { query: "xqc" },
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    const staleRequestId = api.search.all.mock.calls[0][0].requestId;

    rerender({ query: "shroud" });

    await waitFor(() =>
      expect(api.search.cancel).toHaveBeenCalledWith({ requestId: staleRequestId })
    );
  });

  it("traces request start, first useful channels, and full hydration", async () => {
    const twitchChannel = fixtures.channel({ platform: "twitch", username: "xqc" });
    const broad = deferred<{
      success: true;
      data: SearchAllResponse;
      providers: { twitch: "complete"; kick: "complete" };
    }>();
    api.logs.write = vi.fn();
    api.search.channels = vi.fn(async ({ platform }) => ({
      data: platform === "twitch" ? [twitchChannel] : [],
      error: null,
      cursor: null,
    }));
    api.search.all = vi.fn(() => broad.promise);

    renderHook(() => useSearchAll("xqc"), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(api.logs.write).toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ stage: "first-useful" }) })
      )
    );
    broad.resolve({
      success: true,
      data: { channels: [twitchChannel], categories: [], streams: [], videos: [], clips: [] },
      providers: { twitch: "complete", kick: "complete" },
    });

    await waitFor(() => {
      const stages = api.logs.write.mock.calls.map(
        (call: Array<{ meta?: { stage?: string } }>) => call[0]?.meta?.stage
      );
      expect(stages).toEqual(
        expect.arrayContaining(["request-start", "first-useful", "full-hydration"])
      );
    });
  });

  it("does not report full hydration when the broad response is rejected by the persisted schema", async () => {
    const liveChannel = fixtures.channel({
      id: "live-channel-shaped-stream",
      platform: "twitch",
      username: "xqc",
      displayName: "xQc",
      isLive: true,
    });
    const malformedBoundaryResponse = {
      success: true,
      data: {
        channels: [liveChannel],
        categories: [],
        streams: [{ ...liveChannel, platform: "twitch" }],
        videos: [],
        clips: [],
      },
      providers: { twitch: "complete", kick: "complete" },
    } as unknown as Awaited<ReturnType<typeof api.search.all>>;
    api.logs.write = vi.fn();
    api.search.channels = vi.fn(async () => ({ data: [], error: null, cursor: null }));
    api.search.all = vi.fn(async () => malformedBoundaryResponse);

    const { result } = renderHook(() => useSearchAll("xqc"), { wrapper: makeWrapper() });

    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data?.channels).toEqual([liveChannel]));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.store.set).not.toHaveBeenCalled();
    expect(api.logs.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ stage: "full-hydration" }) })
    );
  });

  it("labels cached publication separately and delays full hydration timing until remote acceptance", async () => {
    const cached: SearchAllResponse = {
      channels: [
        fixtures.channel({ username: "timedcache", displayName: "Timed Cache" }),
      ],
      categories: [fixtures.category({ name: "Timed Cache" })],
      streams: [fixtures.stream({ channelName: "timedcache" })],
      videos: [
        {
          id: "video-1", platform: "twitch", channelId: "channel-1",
          channelName: "timedcache", channelDisplayName: "Timed Cache", channelAvatar: "",
          title: "Timed cache video", thumbnailUrl: "", duration: 10, viewCount: 1,
          publishedAt: "2026-01-01T00:00:00.000Z", url: "https://example.com/video",
          type: "archive",
        },
      ],
      clips: [
        {
          id: "clip-1", platform: "twitch", channelId: "channel-1",
          channelName: "timedcache", channelDisplayName: "Timed Cache", channelAvatar: "",
          title: "Timed cache clip", thumbnailUrl: "", clipUrl: "https://example.com/clip",
          embedUrl: "https://example.com/clip/embed", duration: 10, viewCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z", creatorName: "creator",
        },
      ],
    };
    const persistedValues = new Map<string, unknown>();
    api.store.get = vi.fn(async (key: string) => persistedValues.get(key) ?? null);
    api.store.set = vi.fn(async (key: string, value: unknown) => {
      persistedValues.set(key, value);
    });
    await savePersistedSearchResult("timed cache", undefined, 5, cached);
    resetPersistedSearchResultsLruForTests();
    const client = createQueryClient();
    await hydratePersistedBrowseSnapshots(client);
    const broad = deferred<{
      success: true;
      data: SearchAllResponse;
      providers: { twitch: "complete"; kick: "complete" };
    }>();
    api.logs.write = vi.fn();
    api.search.channels = vi.fn(() => new Promise<never>(() => undefined));
    api.search.all = vi.fn(() => broad.promise);

    renderHook(() => useSearchAll("timed cache"), { wrapper: makeWrapper(client) });

    await waitFor(() =>
      expect(api.logs.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ stage: "cache-publication", count: 5 }),
        })
      )
    );
    expect(api.logs.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ stage: "full-hydration" }) })
    );

    broad.resolve({
      success: true,
      data: cached,
      providers: { twitch: "complete", kick: "complete" },
    });
    await waitFor(() =>
      expect(api.logs.write).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ stage: "full-hydration", count: 5 }),
        })
      )
    );
  });

  it("emits one request-start trace for one logical request under StrictMode", async () => {
    api.logs.write = vi.fn();
    api.search.all = vi.fn(async () => ({
      data: { channels: [], categories: [], streams: [], videos: [], clips: [] },
      error: null,
    }));

    const { result } = renderHook(() => useSearchAll("xqc"), {
      wrapper: makeWrapper(),
      reactStrictMode: true,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const requestStarts = api.logs.write.mock.calls
      .map((call: Array<{ meta?: { requestId?: number; stage?: string } }>) => call[0])
      .filter((payload: { meta?: { stage?: string } }) => payload.meta?.stage === "request-start");
    expect(requestStarts).toHaveLength(1);
    expect(api.search.all).toHaveBeenCalledTimes(1);
  });

  it("ranks an exact Kick channel ahead of a Twitch prefix during progressive hydration", async () => {
    const twitchPrefix = fixtures.channel({
      platform: "twitch",
      username: "xqcfan",
      displayName: "xQc Fan",
      followerCount: 1_000_000,
    });
    const kickExact = fixtures.channel({
      id: "kick-xqc",
      platform: "kick",
      username: "xqc",
      displayName: "xQc",
      followerCount: 1,
    });
    api.search.channels = vi.fn(async ({ platform }) => ({
      data: platform === "twitch" ? [twitchPrefix] : [kickExact],
      error: null,
      cursor: null,
    }));
    api.search.all = vi.fn(() => new Promise<never>(() => undefined));

    const { result } = renderHook(() => useSearchAll("xqc"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data?.channels).toHaveLength(2));
    expect(result.current.data?.channels.map((channel) => channel.username)).toEqual([
      "xqc",
      "xqcfan",
    ]);
  });

  it("fetches combined search results", async () => {
    const payload = {
      channels: [fixtures.channel()],
      categories: [fixtures.category()],
      streams: [],
      videos: [],
      clips: [],
    };
    api.search.all = vi.fn(async () => ({ data: payload, error: null }));

    const { result } = renderHook(() => useSearchAll("test"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.channels).toHaveLength(1);
    expect(result.current.data!.categories).toHaveLength(1);
  });

  it("clears previous-key results while the next submitted query is pending", async () => {
    const firstPayload = {
      channels: [fixtures.channel({ username: "first" })],
      categories: [],
      streams: [],
      videos: [],
      clips: [],
    };
    let resolveSecond!: (value: { data: typeof firstPayload; error: null }) => void;
    const secondRequest = new Promise<{ data: typeof firstPayload; error: null }>((resolve) => {
      resolveSecond = resolve;
    });
    api.search.all = vi.fn(({ query }) =>
      query === "first" ? Promise.resolve({ data: firstPayload, error: null }) : secondRequest
    );

    const { result, rerender } = renderHook(({ query }) => useSearchAll(query), {
      initialProps: { query: "first" },
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data?.channels[0].username).toBe("first"));

    rerender({ query: "second" });
    await waitFor(() => expect(api.search.all).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();

    resolveSecond({
      data: { ...firstPayload, channels: [fixtures.channel({ username: "second" })] },
      error: null,
    });
    await waitFor(() => expect(result.current.data?.channels[0].username).toBe("second"));
  });

  it("returns an exact-key cached submitted result immediately without another IPC request", async () => {
    const wrapper = makeWrapper();
    const payload = {
      channels: [fixtures.channel({ username: "cached" })],
      categories: [],
      streams: [],
      videos: [],
      clips: [],
    };
    api.search.all = vi.fn(async () => ({ data: payload, error: null }));

    const first = renderHook(() => useSearchAll("cached"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useSearchAll(" cached "), { wrapper });

    expect(second.result.current.data?.channels[0].username).toBe("cached");
    expect(api.search.all).toHaveBeenCalledTimes(1);
  });

  it("exposes a truthful cold loading response within the 50ms app-owned budget", () => {
    vi.useFakeTimers();
    let providerSettled = false;
    api.search.all = vi.fn(() =>
      new Promise<never>(() => undefined).finally(() => {
        providerSettled = true;
      })
    );

    try {
      const startedAt = performance.now();
      const pending = renderHook(() => useSearchAll("cold"), { wrapper: makeWrapper() });
      const responseMs = performance.now() - startedAt;

      expect(pending.result.current.isLoading).toBe(true);
      expect(pending.result.current.data).toBeUndefined();
      expect(responseMs).toBeLessThan(50);
      expect(api.search.channels).toHaveBeenCalledTimes(2);
      expect(api.search.all).not.toHaveBeenCalled();
      expect(providerSettled).toBe(false);
      pending.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(() => useSearchAll(""), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("fetches one-character combined queries", async () => {
    api.search.all = vi.fn(async () => ({
      data: { channels: [], categories: [], streams: [], videos: [], clips: [] },
      error: null,
    }));

    const { result } = renderHook(() => useSearchAll("x"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search.all).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "x",
        platform: undefined,
        limit: 5,
        channelSeeds: [],
        requestId: expect.any(String),
      })
    );
  });
});
