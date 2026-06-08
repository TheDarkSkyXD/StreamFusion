import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchAll, useSearchCategories, useSearchChannels } from "@/hooks/queries/useSearch";
import { installElectronAPIMock, fixtures } from "../../test-utils";

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
describe("useSearchChannels", () => {
  it("fetches channel search results", async () => {
    const ch = fixtures.channel({ username: "xqc" });
    api.search.channels = vi.fn(async () => ({ data: [ch], error: null, cursor: null }));

    const { result } = renderHook(
      () => useSearchChannels("xqc"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages[0].data).toHaveLength(1);
    expect(result.current.data!.pages[0].data[0].username).toBe("xqc");
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(
      () => useSearchChannels(""),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("treats empty data page as end-of-list (no next page)", async () => {
    api.search.channels = vi.fn(async () => ({
      data: [],
      error: null,
      cursor: "some-cursor",
    }));
    const { result } = renderHook(
      () => useSearchChannels("ghost"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useSearchCategories", () => {
  it("fetches category search results", async () => {
    const cat = fixtures.category({ name: "Fortnite" });
    api.categories.search = vi.fn(async () => ({ data: [cat], error: null, cursor: null }));

    const { result } = renderHook(
      () => useSearchCategories("fortnite"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages[0].data).toHaveLength(1);
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(
      () => useSearchCategories(""),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

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

    const { result } = renderHook(
      () => useSearchAll("test"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.channels).toHaveLength(1);
    expect(result.current.data!.categories).toHaveLength(1);
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(
      () => useSearchAll(""),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});
