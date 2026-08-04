import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchAll, useSearchCategories, useSearchChannels } from "@/hooks/queries/useSearch";
import { fixtures, installElectronAPIMock } from "../../test-utils";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
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
    let resolveSecond!: (value: { data: typeof ch[]; error: null; cursor: null }) => void;
    const secondRequest = new Promise<{ data: typeof ch[]; error: null; cursor: null }>((resolve) => {
      resolveSecond = resolve;
    });
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

// Guards: submitted search never presents previous-key results as the next query's cold response.
describe("useSearchAll", () => {
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
    api.search.all = vi.fn(
      () =>
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
      expect(api.search.all).toHaveBeenCalledTimes(1);
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
    expect(api.search.all).toHaveBeenCalledWith({
      query: "x",
      platform: undefined,
      limit: 5,
    });
  });
});
