import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CATEGORY_KEYS,
  useCategoryById,
  useCategoryMetadata,
  useTopCategories,
} from "@/hooks/queries/useCategories";
import { hydratePersistedBrowseSnapshots } from "@/hooks/queries/browse-snapshot-bootstrap";
import { logger } from "@/renderer/logging/logger";
import { installElectronAPIMock, fixtures } from "../../test-utils";

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function rankedCatalog(count: number) {
  return Array.from({ length: count }, (_, index) =>
    fixtures.category({
      id: `ranked-${index}`,
      name: `Ranked Category ${index}`,
      platform: "twitch",
      viewerCount: count - index,
    })
  );
}

let api: ReturnType<typeof installElectronAPIMock>;

type TopCategoriesResult = Awaited<ReturnType<typeof api.categories.getTop>>;
type TopCategoriesSuccess = Extract<TopCategoriesResult, { success: true }>;
type TopCategoriesTestResult =
  | (Omit<TopCategoriesSuccess, "providers"> & { providers?: TopCategoriesSuccess["providers"] })
  | Extract<TopCategoriesResult, { success: false }>;

const mockGetTopCategories = (
  implementation: (
    params?: Parameters<typeof api.categories.getTop>[0]
  ) => Promise<TopCategoriesTestResult>
) =>
  vi.fn<typeof api.categories.getTop>(async (params) => {
    const result = await implementation(params);
    return result.success ? { ...result, providers: result.providers ?? {} } : result;
  });
const mockGetTopStreams = (implementation: typeof api.streams.getTop) => vi.fn(implementation);
const mockGetCategoryById = (implementation: typeof api.categories.getById) =>
  vi.fn(implementation);
const mockGetCategoryMetadata = (implementation: typeof api.categories.getMetadata) =>
  vi.fn(implementation);

beforeEach(() => {
  vi.clearAllMocks();
  api = installElectronAPIMock();
});

afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Guards: useTopCategories dedups Twitch + Kick rows by normalized name and sums viewer counts so "Just Chatting" appears once with combined viewership (the merged card the Categories grid renders)
// Guards: a successful merged catalog survives a fresh renderer query cache, paints inside 50ms without upstream, and refreshes once in the background
// Guards: warm category revalidation skips both bounded preview IPCs and goes directly to one exhaustive refresh while cached cards stay published.
// Guards: a warm persisted catalog emits one sub-50ms cache-publication timing per StrictMode-shared discovery request
// Guards: a partial provider refresh cannot replace or persist the last complete catalog
// Guards: exhaustive category responses without provider completion metadata cannot replace or persist the last complete catalog
// Guards: persisted category discovery records contain only allowlisted public category fields
// Guards: exhaustive catalogs persist a ranked, bounded restart subset before full hydration is reported.
// Guards: the first bounded platform page replaces skeletons before the other platform, stream aggregation, or exhaustive catalog settles
// Guards: exhaustive hydration waits for both bounded page-one requests, preventing duplicate page-one contention on either platform
// Guards: rejected preview IPC calls cannot strand the category query before exhaustive fallback runs
// Guards: unmounted category consumers cancel their generation before it can launch exhaustive hydration
// Guards: StrictMode-style unmount/remount reuses one logical cold request instead of duplicating preview IPC and traces
// Guards: the exhaustive category catalog stays quiet on timers and window focus, but explicit invalidation still refreshes it
// Guards: useTopCategories surfaces the Kick winner for the "slots" key ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â preserves the better-metadata exception
// Guards: useCategoryById stays idle when categoryId is empty so CategoryDetail's first render doesn't fan out a fetch with an empty id
// Guards: useCategoryMetadata is twitch-only ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Kick categories must short-circuit (their tags ship in the bulk fetch)
describe("useTopCategories", () => {
  it("publishes the last successful catalog immediately after restart while one refresh runs", async () => {
    const twitch = fixtures.category({
      id: "twitch-restart",
      name: "Restart Category",
      platform: "twitch",
      viewerCount: 1_000,
    });
    const kick = fixtures.category({
      id: "kick-restart",
      name: "Restart Category",
      platform: "kick",
      viewerCount: 500,
    });
    const persistedValues = new Map<string, unknown>();
    api.store.get = vi.fn(async (key: string) => persistedValues.get(key) ?? null);
    api.store.set = vi.fn(async (key: string, value: unknown) => {
      persistedValues.set(key, value);
    });
    api.categories.getTop = mockGetTopCategories(async (params = {}) => {
      if (params.limit && params.platform === "twitch") return { success: true, data: [twitch] };
      if (params.limit && params.platform === "kick") return { success: true, data: [kick] };
      return {
        success: true,
        data: [twitch, kick],
        providers: { twitch: "complete", kick: "complete" },
      };
    });
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const firstMount = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(firstMount.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(api.store.set).toHaveBeenCalledWith(
        "browse-query-snapshot:v1:categories:all",
        expect.anything()
      )
    );
    firstMount.unmount();

    const restartedClient = createQueryClient();
    const startedAt = performance.now();
    await hydratePersistedBrowseSnapshots(restartedClient);
    const pendingTwitch = deferred<{ success: true; data: never[] }>();
    const pendingKick = deferred<{ success: true; data: never[] }>();
    api.categories.getTop = mockGetTopCategories((params = {}) =>
      params.platform === "twitch" ? pendingTwitch.promise : pendingKick.promise
    );
    api.streams.getTop = mockGetTopStreams(() => new Promise(() => undefined));

    const restarted = renderHook(() => useTopCategories(), {
      wrapper: makeWrapper(restartedClient),
    });
    const bootstrapToPublicationMs = performance.now() - startedAt;

    expect(restarted.result.current.data).toEqual([
      expect.objectContaining({ id: "twitch-restart", viewerCount: 1_500 }),
    ]);
    expect(bootstrapToPublicationMs).toBeLessThan(50);
    await waitFor(() => expect(api.categories.getTop).toHaveBeenCalledTimes(1));
    expect(api.categories.getTop).toHaveBeenCalledWith({ platform: undefined });
    restarted.unmount();
  });

  it("revalidates a warm catalog with one exhaustive request and no bounded previews", async () => {
    const cached = fixtures.category({
      id: "production-bootstrap-category",
      name: "Production Bootstrap Category",
      platform: "twitch",
    });
    api.store.get = vi.fn(async (key: string) =>
      key.endsWith("categories:all")
        ? {
            version: 1,
            identity: JSON.stringify("all"),
            savedAt: Date.now(),
            data: [cached],
          }
        : null
    );
    const client = createProductionQueryClient();
    await hydratePersistedBrowseSnapshots(client);
    api.categories.getTop = mockGetTopCategories(() => new Promise<never>(() => undefined));
    api.streams.getTop = mockGetTopStreams(() => new Promise<never>(() => undefined));

    const mounted = renderHook(() => useTopCategories(), {
      wrapper: makeWrapper(client),
      reactStrictMode: true,
    });

    expect(mounted.result.current.data).toEqual([cached]);
    await waitFor(() => expect(api.categories.getTop).toHaveBeenCalledTimes(1));
    expect(api.categories.getTop).toHaveBeenCalledWith({ platform: undefined });
    expect(api.categories.getTop).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: expect.any(Number) })
    );
    expect(mounted.result.current.data).toEqual([cached]);
    const requestStarts = vi
      .mocked(logger.info)
      .mock.calls.filter(([, , meta]) => meta?.stage === "request-start");
    expect(requestStarts).toHaveLength(1);
    mounted.unmount();
  });

  it("publishes the bounded ranked subset immediately after an oversized catalog restart", async () => {
    const catalog = rankedCatalog(5_200);
    const persistedValues = new Map<string, unknown>();
    api.store.get = vi.fn(async (key: string) => persistedValues.get(key) ?? null);
    api.store.set = vi.fn(async (key: string, value: unknown) => {
      persistedValues.set(key, value);
    });
    api.categories.getTop = mockGetTopCategories(async (params = {}) =>
      params.limit
        ? { success: true, data: catalog.slice(0, params.limit) }
        : {
            success: true,
            data: catalog,
            providers: { twitch: "complete", kick: "complete" },
          }
    );
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const first = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(first.result.current.data).toHaveLength(5_200));
    await waitFor(() => expect(api.store.set).toHaveBeenCalledTimes(1));
    first.unmount();

    const restartedClient = createQueryClient();
    const startedAt = performance.now();
    await hydratePersistedBrowseSnapshots(restartedClient);
    api.categories.getTop = mockGetTopCategories(() => new Promise<never>(() => undefined));
    api.streams.getTop = mockGetTopStreams(() => new Promise<never>(() => undefined));
    const restarted = renderHook(() => useTopCategories(), {
      wrapper: makeWrapper(restartedClient),
    });
    const bootstrapToPublicationMs = performance.now() - startedAt;

    expect(restarted.result.current.data).toHaveLength(5_000);
    expect(restarted.result.current.data?.[0]?.id).toBe("ranked-0");
    expect(restarted.result.current.data?.at(-1)?.id).toBe("ranked-4999");
    expect(bootstrapToPublicationMs).toBeLessThan(50);
    restarted.unmount();
  });

  it("traces one warm cache publication before StrictMode-shared upstream work settles", async () => {
    const cached = fixtures.category({
      id: "timed-warm-category",
      name: "Timed Warm Category",
      platform: "twitch",
    });
    const client = createQueryClient();
    client.setQueryData(CATEGORY_KEYS.top(undefined), [cached], { updatedAt: 0 });
    api.categories.getTop = mockGetTopCategories(() => new Promise<never>(() => undefined));
    api.streams.getTop = mockGetTopStreams(() => new Promise<never>(() => undefined));

    const { unmount } = renderHook(() => useTopCategories(), {
      wrapper: makeWrapper(client),
      reactStrictMode: true,
    });

    await waitFor(() => expect(api.categories.getTop).toHaveBeenCalledTimes(1));
    expect(api.categories.getTop).toHaveBeenCalledWith({ platform: undefined });
    const publications = vi
      .mocked(logger.info)
      .mock.calls.filter(([, message]) => message === "cached category catalog published");
    expect(publications).toHaveLength(1);
    expect(publications[0]).toEqual([
      "Hook:Queries:Categories",
      "cached category catalog published",
      expect.objectContaining({
        requestId: expect.any(Number),
        platform: "all",
        stage: "cache-publication",
        count: 1,
        elapsedMs: expect.any(Number),
      }),
    ]);
    expect((publications[0][2] as { elapsedMs: number }).elapsedMs).toBeLessThan(50);
    unmount();
  });

  it("keeps the last complete catalog when one provider refresh fails", async () => {
    const cached = fixtures.category({
      id: "cached-complete",
      name: "Last Known Good",
      platform: "twitch",
      viewerCount: 900,
    });
    const partial = fixtures.category({
      id: "partial-twitch",
      name: "Partial Result",
      platform: "twitch",
      viewerCount: 2_000,
    });
    const client = createQueryClient();
    client.setQueryData(CATEGORY_KEYS.top(undefined), [cached], { updatedAt: 0 });
    api.categories.getTop = mockGetTopCategories(async (params = {}) =>
      params.limit
        ? { success: true, data: [partial] }
        : {
            success: true,
            data: [partial],
            providers: { twitch: "complete", kick: "failed" },
          }
    );
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(result.current.data).toEqual([expect.objectContaining({ id: "cached-complete" })]);
    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("surfaces a failed query when every provider fails and no catalog is cached", async () => {
    api.categories.getTop = mockGetTopCategories(async (params = {}) => ({
      success: true,
      data: [],
      providers: params.platform
        ? { [params.platform]: "failed" as const }
        : { twitch: "failed" as const, kick: "failed" as const },
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: false, error: "offline" }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("keeps the last complete catalog when provider completion metadata is absent", async () => {
    const cached = fixtures.category({
      id: "cached-without-status",
      name: "Cached Without Status",
      platform: "twitch",
    });
    const untrusted = fixtures.category({
      id: "untrusted-without-status",
      name: "Untrusted Without Status",
      platform: "twitch",
    });
    const client = createQueryClient();
    client.setQueryData(CATEGORY_KEYS.top(undefined), [cached], { updatedAt: 0 });
    api.categories.getTop = mockGetTopCategories(async (params = {}) => ({
      success: true,
      data: [untrusted],
      ...(params.limit && params.platform
        ? { providers: { [params.platform]: "complete" as const } }
        : {}),
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(result.current.data).toEqual([expect.objectContaining({ id: "cached-without-status" })]);
    expect(api.store.set).not.toHaveBeenCalled();
  });

  it("does not persist unknown fields from category provider payloads", async () => {
    const category = {
      ...fixtures.category({ id: "safe-category", platform: "twitch" }),
      accessToken: "must-not-persist",
    };
    api.categories.getTop = mockGetTopCategories(async (params = {}) => ({
      success: true,
      data: [category],
      ...(params.limit ? {} : { providers: { twitch: "complete", kick: "complete" } as const }),
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(api.store.set).toHaveBeenCalled());

    const snapshot = vi.mocked(api.store.set).mock.calls.at(-1)?.[1] as {
      data: Array<Record<string, unknown>>;
    };
    expect(snapshot.data[0]).not.toHaveProperty("accessToken");
  });

  it("persists a ranked bounded subset before reporting an oversized full catalog hydrated", async () => {
    const catalog = rankedCatalog(5_200);
    const durableWrite = deferred<void>();
    api.store.set = vi.fn(async () => durableWrite.promise);
    api.categories.getTop = mockGetTopCategories(async (params = {}) =>
      params.limit
        ? { success: true, data: catalog.slice(0, params.limit) }
        : {
            success: true,
            data: catalog,
            providers: { twitch: "complete", kick: "complete" },
          }
    );
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toHaveLength(5_200));
    expect(logger.info).not.toHaveBeenCalledWith(
      "Hook:Queries:Categories",
      "full category catalog ready",
      expect.objectContaining({ stage: "full-hydration" })
    );
    await waitFor(() => expect(api.store.set).toHaveBeenCalledTimes(1));

    const snapshot = vi.mocked(api.store.set).mock.calls[0][1] as {
      data: Array<{ id: string }>;
    };
    expect(snapshot.data).toHaveLength(5_000);
    expect(snapshot.data[0]?.id).toBe("ranked-0");
    expect(snapshot.data.at(-1)?.id).toBe("ranked-4999");
    expect(new TextEncoder().encode(JSON.stringify(snapshot.data)).byteLength).toBeLessThanOrEqual(
      2_000_000
    );

    durableWrite.resolve();
    await waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        "Hook:Queries:Categories",
        "full category catalog ready",
        expect.objectContaining({ stage: "full-hydration", count: 5_200 })
      )
    );
  });

  it("publishes 12 useful cards from the first platform while full hydration continues", async () => {
    const twitchPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const kickPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const fullCatalog = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const streams = deferred<{ success: true; data: never[] }>();
    const twitchCategories = Array.from({ length: 12 }, (_, index) =>
      fixtures.category({
        id: `twitch-${index}`,
        name: `Twitch Category ${index}`,
        platform: "twitch",
        viewerCount: 12_000 - index,
      })
    );

    api.categories.getTop = mockGetTopCategories((params = {}) => {
      if (params.limit && params.platform === "twitch") return twitchPreview.promise;
      if (params.limit && params.platform === "kick") return kickPreview.promise;
      return fullCatalog.promise;
    });
    api.streams.getTop = mockGetTopStreams(() => streams.promise);

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(api.categories.getTop).toHaveBeenCalledWith({ platform: "twitch", limit: 12 });
      expect(api.categories.getTop).toHaveBeenCalledWith({ platform: "kick", limit: 12 });
    });

    twitchPreview.resolve({ success: true, data: twitchCategories });

    await waitFor(() => expect(result.current.data).toHaveLength(12));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(true);
    expect(api.streams.getTop).toHaveBeenCalledTimes(1);
    expect(api.categories.getTop).not.toHaveBeenCalledWith({ platform: undefined });
    expect(logger.info).toHaveBeenCalledWith(
      "Hook:Queries:Categories",
      "category discovery request started",
      expect.objectContaining({ stage: "request-start" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Hook:Queries:Categories",
      "first useful category batch ready",
      expect.objectContaining({ stage: "first-useful", count: 12, elapsedMs: expect.any(Number) })
    );

    kickPreview.resolve({ success: true, data: [] });
    await waitFor(() =>
      expect(api.categories.getTop).toHaveBeenCalledWith({ platform: undefined })
    );
  });

  it("continues to exhaustive hydration when bounded preview IPC rejects", async () => {
    const fullCategory = fixtures.category({
      id: "full-1",
      name: "Recovered Category",
      platform: "twitch",
    });
    api.categories.getTop = mockGetTopCategories(async (params = {}) => {
      if (params.limit) throw new Error(`${params.platform} offline`);
      return {
        success: true,
        data: [fullCategory],
        providers: { twitch: "complete", kick: "complete" },
      };
    });
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([expect.objectContaining({ id: "full-1" })]);
  });

  it("does not launch exhaustive hydration after the query is cancelled", async () => {
    const twitchPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const kickPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const previewCategory = fixtures.category({
      id: "preview-1",
      name: "Preview Category",
      platform: "twitch",
    });
    api.categories.getTop = mockGetTopCategories((params = {}) => {
      if (params.platform === "twitch") return twitchPreview.promise;
      if (params.platform === "kick") return kickPreview.promise;
      return Promise.resolve({ success: true, data: [] });
    });
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result, unmount } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    twitchPreview.resolve({ success: true, data: [previewCategory] });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    unmount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    kickPreview.resolve({ success: true, data: [] });
    await act(async () => Promise.resolve());

    expect(api.categories.getTop).not.toHaveBeenCalledWith({ platform: undefined });
  });

  it("reuses one cold request across an immediate unmount and remount", async () => {
    const twitchPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const kickPreview = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    const fullCatalog = deferred<{
      success: true;
      data: ReturnType<typeof fixtures.category>[];
    }>();
    api.categories.getTop = mockGetTopCategories((params = {}) => {
      if (params.platform === "twitch") return twitchPreview.promise;
      if (params.platform === "kick") return kickPreview.promise;
      return fullCatalog.promise;
    });
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));
    const client = createQueryClient();
    const wrapper = makeWrapper(client);

    const firstMount = renderHook(() => useTopCategories(), { wrapper });
    await waitFor(() => expect(api.categories.getTop).toHaveBeenCalledTimes(2));
    firstMount.unmount();

    const secondMount = renderHook(() => useTopCategories(), { wrapper });
    await waitFor(() => expect(secondMount.result.current.fetchStatus).toBe("fetching"));
    await act(async () => Promise.resolve());

    const boundedCalls = vi
      .mocked(api.categories.getTop)
      .mock.calls.filter((call: Parameters<typeof api.categories.getTop>) => {
        const params = call[0] as { limit?: number } | undefined;
        return params?.limit === 12;
      });
    expect(boundedCalls).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Hook:Queries:Categories",
      "category discovery request started",
      expect.objectContaining({ requestId: expect.any(Number), stage: "request-start" })
    );

    secondMount.unmount();
  });

  it("fetches and returns categories enriched with viewer counts", async () => {
    const cat = fixtures.category({ id: "cat-1", name: "Just Chatting", platform: "twitch" });
    const stream = fixtures.stream({ categoryId: "cat-1", viewerCount: 5000 });
    api.categories.getTop = mockGetTopCategories(async (params = {}) => ({
      success: true,
      data: [cat],
      providers: params.platform
        ? { [params.platform]: "complete" as const }
        : { twitch: "complete" as const, kick: "complete" as const },
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [stream] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].viewerCount).toBeGreaterThanOrEqual(5000);
    expect(logger.info).toHaveBeenCalledWith(
      "Hook:Queries:Categories",
      "full category catalog ready",
      expect.objectContaining({ stage: "full-hydration", count: 1, elapsedMs: expect.any(Number) })
    );
  });

  it("deduplicates Twitch+Kick categories by normalized name (Twitch wins)", async () => {
    const twitchCat = fixtures.category({
      id: "t1",
      name: "Just Chatting",
      platform: "twitch",
      viewerCount: 1000,
    });
    const kickCat = fixtures.category({
      id: "k1",
      name: "Just Chatting",
      platform: "kick",
      viewerCount: 500,
    });
    api.categories.getTop = mockGetTopCategories(async () => ({
      success: true,
      data: [twitchCat, kickCat],
      providers: { twitch: "complete", kick: "complete" },
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const justChattingEntries = result.current.data!.filter((c) => c.name === "Just Chatting");
    expect(justChattingEntries).toHaveLength(1);
    expect(justChattingEntries[0].platform).toBe("twitch");
    expect(justChattingEntries[0].viewerCount).toBe(1500);
    expect(justChattingEntries[0].crossPlatformId).toBe("k1");
    expect(justChattingEntries[0].crossPlatformName).toBe("Just Chatting");
  });

  it("filters by platform when specified", async () => {
    const cat = fixtures.category({ platform: "kick" });
    api.categories.getTop = mockGetTopCategories(async () => ({
      success: true,
      data: [cat],
      providers: { kick: "complete" },
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));

    const { result } = renderHook(() => useTopCategories("kick"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.categories.getTop).toHaveBeenCalledWith({ platform: "kick" });
  });

  it("only refreshes the exhaustive catalog when explicitly invalidated", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    api.categories.getTop = mockGetTopCategories(async () => ({
      success: true,
      data: [],
      providers: { twitch: "complete", kick: "complete" },
    }));
    api.streams.getTop = mockGetTopStreams(async () => ({ success: true, data: [] }));
    const client = createQueryClient();

    const { result, unmount } = renderHook(() => useTopCategories(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isSuccess).toBe(true);
    const exhaustiveCallCount = () =>
      vi
        .mocked(api.categories.getTop)
        .mock.calls.filter((call: Parameters<typeof api.categories.getTop>) => {
          const params = call[0] as { limit?: number } | undefined;
          return params?.limit === undefined;
        }).length;
    expect(exhaustiveCallCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.runAllTicks();
    });
    expect(exhaustiveCallCount()).toBe(1);

    await act(async () => {
      await client.invalidateQueries({ queryKey: CATEGORY_KEYS.top(undefined) });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(exhaustiveCallCount()).toBe(2);
    unmount();
  });
});

describe("useCategoryById", () => {
  it("publishes matching warm-catalog metadata while the detail refresh is pending", async () => {
    const cached = fixtures.category({ id: "cat-warm", platform: "twitch", name: "Warm Game" });
    const client = createQueryClient();
    client.setQueryData(CATEGORY_KEYS.top(undefined), [cached], { updatedAt: 0 });
    api.categories.getById = mockGetCategoryById(() => new Promise<never>(() => undefined));

    const { result } = renderHook(() => useCategoryById("cat-warm", "twitch"), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.data).toEqual(cached);
    await waitFor(() => expect(api.categories.getById).toHaveBeenCalledTimes(1));
    expect(result.current.data).toEqual(cached);
  });

  it("fetches a category by id and platform", async () => {
    const cat = fixtures.category({ id: "cat-99", name: "Fortnite" });
    api.categories.getById = mockGetCategoryById(async () => ({ success: true, data: cat }));

    const { result } = renderHook(() => useCategoryById("cat-99", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "cat-99", name: "Fortnite" });
  });

  it("does not fetch when categoryId is empty", async () => {
    const { result } = renderHook(() => useCategoryById("", "twitch"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.categories.getById).not.toHaveBeenCalled();
  });
});

describe("useCategoryMetadata", () => {
  it("fetches metadata for a Twitch category", async () => {
    api.categories.getMetadata = mockGetCategoryMetadata(async () => ({
      success: true,
      data: { tags: ["fps", "shooter"], streamCount: 0, streamCountExact: true },
    }));
    const cat = fixtures.category({ id: "cat-1", platform: "twitch", slug: "just-chatting" });

    const { result } = renderHook(() => useCategoryMetadata(cat), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      tags: ["fps", "shooter"],
      streamCount: 0,
      streamCountExact: true,
    });
  });

  it("is disabled for Kick categories", async () => {
    const cat = fixtures.category({ id: "cat-1", platform: "kick", slug: "just-chatting" });
    const { result } = renderHook(() => useCategoryMetadata(cat), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});
