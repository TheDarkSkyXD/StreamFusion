import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveFavoriteStreams } from "@/hooks/queries/useLiveFavoriteStreams";
import { type FavoriteStreamRef, useMultiStreamStore } from "@/store/multistream-store";
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

const favorites: FavoriteStreamRef[] = [
  {
    platform: "twitch",
    channelId: "channel-first",
    channelName: "first-live",
    displayName: "First Live",
  },
  {
    platform: "kick",
    channelId: "channel-offline",
    channelName: "offline",
    displayName: "Offline",
  },
  {
    platform: "kick",
    channelId: "channel-last",
    channelName: "last-live",
    displayName: "Last Live",
  },
];

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
  useMultiStreamStore.setState({ favoriteStreams: favorites });
});

afterEach(() => {
  act(() => useMultiStreamStore.setState({ favoriteStreams: [] }));
  vi.restoreAllMocks();
});

// Guards: the Favorites adapter exposes only currently-live saved channels and preserves their saved order
// Guards: loading remains visible until every saved favorite status query has settled
// Guards: one failed favorite surfaces the first saved-order error without hiding other live results
describe("useLiveFavoriteStreams", () => {
  it("returns live favorites in saved order and omits offline favorites", async () => {
    const firstLive = fixtures.stream({
      id: "stream-first",
      channelId: "channel-first",
      channelName: "first-live",
    });
    const lastLive = fixtures.stream({
      id: "stream-last",
      platform: "kick",
      channelId: "channel-last",
      channelName: "last-live",
    });
    const offlineStream = fixtures.stream({
      id: "stream-offline",
      platform: "kick",
      channelId: "channel-offline",
      channelName: "offline",
      isLive: false,
    });
    api.streams.getByChannel = vi.fn<typeof api.streams.getByChannel>(
      async ({ username }: { username: string }) => ({
        success: true,
        data:
          username === "first-live"
            ? firstLive
            : username === "last-live"
              ? lastLive
              : offlineStream,
      })
    );

    const { result } = renderHook(() => useLiveFavoriteStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.streams).toEqual([firstLive, lastLive]));
  });

  it("stays loading while any favorite status query is pending", async () => {
    const firstLive = fixtures.stream({
      id: "stream-first",
      channelId: "channel-first",
      channelName: "first-live",
    });
    const lastLive = fixtures.stream({
      id: "stream-last",
      platform: "kick",
      channelId: "channel-last",
      channelName: "last-live",
    });
    let resolveLast!: (value: { success: true; data: typeof lastLive }) => void;
    const pendingLast = new Promise<{ success: true; data: typeof lastLive }>((resolve) => {
      resolveLast = resolve;
    });
    api.streams.getByChannel = vi.fn<typeof api.streams.getByChannel>(
      ({ username }: { username: string }) => {
        if (username === "first-live") return Promise.resolve({ success: true, data: firstLive });
        if (username === "last-live") return pendingLast;
        return Promise.resolve({ success: true, data: null });
      }
    );

    const { result } = renderHook(() => useLiveFavoriteStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.streams).toEqual([firstLive]));
    expect(result.current.isLoading).toBe(true);

    await act(async () => resolveLast({ success: true, data: lastLive }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("returns partial live results and the first error in saved order", async () => {
    const middleLive = fixtures.stream({
      id: "stream-middle",
      platform: "kick",
      channelId: "channel-offline",
      channelName: "offline",
    });
    api.streams.getByChannel = vi.fn<typeof api.streams.getByChannel>(
      async ({ username }: { username: string }) => {
        if (username === "first-live") {
          return { success: false, error: "first favorite failed" };
        }
        if (username === "last-live") {
          return { success: false, error: "later favorite failed" };
        }
        return { success: true, data: middleLive };
      }
    );

    const { result } = renderHook(() => useLiveFavoriteStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streams).toEqual([middleLive]);
    expect(result.current.error?.message).toBe("first favorite failed");
  });
});
