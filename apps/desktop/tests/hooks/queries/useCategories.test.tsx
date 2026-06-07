import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCategoryById, useCategoryMetadata, useTopCategories } from "@/hooks/queries/useCategories";
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

describe("useTopCategories", () => {
  it("fetches and returns categories enriched with viewer counts", async () => {
    const cat = fixtures.category({ id: "cat-1", name: "Just Chatting", platform: "twitch" });
    const stream = fixtures.stream({ categoryId: "cat-1", viewerCount: 5000 });
    api.categories.getTop = vi.fn(async () => ({ data: [cat], error: null }));
    api.streams.getTop = vi.fn(async () => ({ data: [stream], error: null }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].viewerCount).toBeGreaterThanOrEqual(5000);
  });

  it("throws when the categories response has an error", async () => {
    api.categories.getTop = vi.fn(async () => ({ data: null, error: "network" }));
    api.streams.getTop = vi.fn(async () => ({ data: [], error: null }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("deduplicates Twitch+Kick categories by normalized name (Twitch wins)", async () => {
    const twitchCat = fixtures.category({ id: "t1", name: "Just Chatting", platform: "twitch", viewerCount: 1000 });
    const kickCat = fixtures.category({ id: "k1", name: "Just Chatting", platform: "kick", viewerCount: 500 });
    api.categories.getTop = vi.fn(async () => ({ data: [twitchCat, kickCat], error: null }));
    api.streams.getTop = vi.fn(async () => ({ data: [], error: null }));

    const { result } = renderHook(() => useTopCategories(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const justChattingEntries = result.current.data!.filter(
      (c) => c.name === "Just Chatting"
    );
    expect(justChattingEntries).toHaveLength(1);
    expect(justChattingEntries[0].platform).toBe("twitch");
    expect(justChattingEntries[0].viewerCount).toBe(1500);
  });

  it("filters by platform when specified", async () => {
    const cat = fixtures.category({ platform: "kick" });
    api.categories.getTop = vi.fn(async () => ({ data: [cat], error: null }));
    api.streams.getTop = vi.fn(async () => ({ data: [], error: null }));

    const { result } = renderHook(() => useTopCategories("kick"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.categories.getTop).toHaveBeenCalledWith({ platform: "kick" });
  });
});

describe("useCategoryById", () => {
  it("fetches a category by id and platform", async () => {
    const cat = fixtures.category({ id: "cat-99", name: "Fortnite" });
    api.categories.getById = vi.fn(async () => ({ data: cat, error: null }));

    const { result } = renderHook(
      () => useCategoryById("cat-99", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "cat-99", name: "Fortnite" });
  });

  it("throws when the response has an error", async () => {
    api.categories.getById = vi.fn(async () => ({ data: null, error: "not found" }));
    const { result } = renderHook(
      () => useCategoryById("bad", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not fetch when categoryId is empty", async () => {
    const { result } = renderHook(
      () => useCategoryById("", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.categories.getById).not.toHaveBeenCalled();
  });
});

describe("useCategoryMetadata", () => {
  it("fetches metadata for a Twitch category", async () => {
    api.categories.getMetadata = vi.fn(async () => ({
      data: { tags: ["fps", "shooter"] },
      error: null,
    }));
    const cat = fixtures.category({ id: "cat-1", platform: "twitch", slug: "just-chatting" });

    const { result } = renderHook(
      () => useCategoryMetadata(cat),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ tags: ["fps", "shooter"] });
  });

  it("is disabled for Kick categories", async () => {
    const cat = fixtures.category({ id: "cat-1", platform: "kick", slug: "just-chatting" });
    const { result } = renderHook(
      () => useCategoryMetadata(cat),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});
