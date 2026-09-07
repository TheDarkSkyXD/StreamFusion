import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installElectronAPIMock } from "../../../../../../tests/test-utils";
import { useCategoryMedia } from "@/features/discovery/components/hooks/queries/useCategoryMedia";

const read = vi.fn();
const page = (cursor?: string) => ({ success: true, availability: "available", data: [], cursor });
beforeEach(() => {
  const api = installElectronAPIMock();
  read.mockReset();
  api.videos.getByCategory = read;
});
function renderMedia() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...renderHook(
      () =>
        useCategoryMedia({
          kind: "videos",
          platformScope: "twitch",
          twitch: { platform: "twitch", categoryId: "509660" },
          kick: { platform: "kick", categoryId: "" },
          sort: "recent",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    ),
  };
}

// Guards: retained pagination cursors cannot automatically retry a failed page or cycle through old pages.
describe("category media pagination", () => {
  it("halts continuation after a failed next page until explicit Retry", async () => {
    read.mockResolvedValueOnce(page("A")).mockRejectedValueOnce(new Error("Page unavailable"));
    const { result } = renderMedia();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.failures).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(false);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValue(page());
    await act(async () => {
      await result.current.failures[0].retry();
    });
    await waitFor(() => expect(result.current.failures).toHaveLength(0));
  });

  it("surfaces A to B to A cursor cycles instead of appending and fetching duplicate pages", async () => {
    read
      .mockResolvedValueOnce(page("A"))
      .mockResolvedValueOnce(page("B"))
      .mockResolvedValueOnce(page("A"));
    const { result } = renderMedia();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(result.current.failures).toHaveLength(0);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.failures[0]?.error?.message).toContain("repeated page cursor")
    );
    expect(result.current.hasNextPage).toBe(false);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, "A", "B"]);
  });

  it("allows an explicit refetch to change the cursor chain from A then B to B then A", async () => {
    read
      .mockResolvedValueOnce(page("A"))
      .mockResolvedValueOnce(page("B"))
      .mockResolvedValueOnce(page());
    const { result, client } = renderMedia();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(read).toHaveBeenCalledTimes(3);
    read
      .mockResolvedValueOnce(page("B"))
      .mockResolvedValueOnce(page("A"))
      .mockResolvedValueOnce(page());
    await act(async () => {
      await client.refetchQueries({ queryKey: ["category-media"], type: "active" });
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(6));
    expect(result.current.failures).toHaveLength(0);
    expect(result.current.hasNextPage).toBe(false);
    expect(read.mock.calls.map(([request]) => request.cursor)).toEqual([
      undefined,
      "A",
      "B",
      undefined,
      "B",
      "A",
    ]);
  });
});
