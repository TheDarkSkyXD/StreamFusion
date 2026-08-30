import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInfiniteStreamsByCategory } from "@/features/discovery/data/queries/useInfiniteStreams";
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

// Guards: useInfiniteStreamsByCategory is enabled when EITHER categoryId or categoryName is set Ã¢â‚¬â€ Kick's category-detail page slug-guesses on name when the numeric id is unknown
// Guards: hasNextPage is false when cursor is missing Ã¢â‚¬â€ prevents an infinite-fetch loop on the last page
// Guards: language filter threads through to IPC verbatim so the category page's language picker actually narrows results
describe("useInfiniteStreamsByCategory", () => {
  it("fetches the first page of streams for a category", async () => {
    const stream = fixtures.stream({ categoryId: "cat-1" });
    api.streams.getByCategory = vi.fn<typeof api.streams.getByCategory>(async () => ({
      success: true,
      providers: { twitch: "complete", kick: "complete" },
      data: [stream],
      cursor: "next-page",
    }));

    const { result } = renderHook(() => useInfiniteStreamsByCategory("cat-1", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pages).toHaveLength(1);
    expect(result.current.data!.pages[0].data).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("reports hasNextPage=false when no cursor is returned", async () => {
    api.streams.getByCategory = vi.fn<typeof api.streams.getByCategory>(async () => ({
      success: true,
      providers: { twitch: "complete", kick: "complete" },
      data: [fixtures.stream()],
      cursor: undefined,
    }));

    const { result } = renderHook(() => useInfiniteStreamsByCategory("cat-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("is disabled when categoryId is empty and no categoryName", async () => {
    const { result } = renderHook(
      () => useInfiniteStreamsByCategory("", undefined, 20, undefined),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("is enabled when categoryId is empty but categoryName is set", async () => {
    api.streams.getByCategory = vi.fn<typeof api.streams.getByCategory>(async () => ({
      success: true,
      providers: { twitch: "complete", kick: "complete" },
      data: [fixtures.stream()],
      cursor: undefined,
    }));
    const { result } = renderHook(
      () => useInfiniteStreamsByCategory("", "kick", 20, "Just Chatting"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("passes language filter to the IPC call", async () => {
    api.streams.getByCategory = vi.fn<typeof api.streams.getByCategory>(async () => ({
      success: true,
      providers: { twitch: "complete", kick: "complete" },
      data: [],
      cursor: undefined,
    }));
    renderHook(() => useInfiniteStreamsByCategory("cat-1", "twitch", 20, "Just Chatting", "en"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      expect(api.streams.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en", categoryName: "Just Chatting" })
      )
    );
  });
});
