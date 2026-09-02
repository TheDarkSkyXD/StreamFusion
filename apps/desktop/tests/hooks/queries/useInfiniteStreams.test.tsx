import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useInfiniteStreamsByCategory,
  useInfiniteTopStreams,
} from "@/features/discovery/data/queries/useInfiniteStreams";
import { installElectronAPIMock, fixtures } from "../../test-utils";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

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
  useAuthStore.setState({ initialized: true, preferences: DEFAULT_USER_PREFERENCES });
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

// Guards: Home waits for the display language and scopes every provider request and cache entry to it.
// Guards: Home pages Twitch and Kick independently so one provider cursor is never sent to the other.
// Guards: every fetched stream remains visible after merge; provider-page results are never sliced away.
// Guards: one provider can fail without hiding usable streams from the other provider.
describe("useInfiniteTopStreams", () => {
  it("loads and merges every row from both provider pages without slicing", async () => {
    const twitchStreams = Array.from({ length: 12 }, (_, index) =>
      fixtures.stream({
        id: `twitch-${index}`,
        platform: "twitch",
        channelId: `twitch-channel-${index}`,
        channelName: `twitch-channel-${index}`,
        viewerCount: 100 - index,
      })
    );
    const kickStreams = Array.from({ length: 12 }, (_, index) =>
      fixtures.stream({
        id: `kick-${index}`,
        platform: "kick",
        channelId: `kick-channel-${index}`,
        channelName: `kick-channel-${index}`,
        viewerCount: 200 - index,
      })
    );
    api.streams.getTop = vi.fn<typeof api.streams.getTop>(async (request = {}) => {
      const { platform } = request;
      return platform === "twitch"
        ? {
            success: true,
            platform,
            providers: { twitch: "complete" },
            data: twitchStreams,
          }
        : {
            success: true,
            platform,
            providers: { kick: "complete" },
            data: kickStreams,
          };
    });

    const { result } = renderHook(() => useInfiniteTopStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toHaveLength(24));
    expect(api.streams.getTop).toHaveBeenCalledTimes(2);
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "twitch",
      language: "en",
      limit: 12,
    });
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "kick",
      language: "en",
      limit: 12,
    });
    expect(result.current.data[0].viewerCount).toBe(200);
  });

  it("advances only the provider that returned a next cursor and deduplicates repeated channels", async () => {
    const first = fixtures.stream({
      id: "first",
      platform: "twitch",
      channelId: "channel-1",
      channelName: "channel-one",
      viewerCount: 10,
    });
    const second = fixtures.stream({
      id: "second",
      platform: "twitch",
      channelId: "channel-2",
      channelName: "channel-two",
      viewerCount: 20,
    });
    api.streams.getTop = vi.fn<typeof api.streams.getTop>(async (request = {}) => {
      const { platform, cursor } = request;
      if (platform === "kick") {
        return { success: true, platform, providers: { kick: "complete" }, data: [] };
      }
      return cursor === "twitch-next"
        ? {
            success: true,
            platform,
            providers: { twitch: "complete" },
            data: [first, second],
          }
        : {
            success: true,
            platform,
            providers: { twitch: "complete" },
            data: [first],
            cursor: "twitch-next",
          };
    });

    const { result } = renderHook(() => useInfiniteTopStreams(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "twitch",
      language: "en",
      limit: 12,
      cursor: "twitch-next",
    });
    expect(
      vi.mocked(api.streams.getTop).mock.calls.filter(([request]) => request?.platform === "kick")
    ).toHaveLength(1);
  });

  it("waits for preferences and reloads both providers for the selected display language", async () => {
    useAuthStore.setState({ initialized: false, preferences: null });
    api.streams.getTop = vi.fn<typeof api.streams.getTop>(async (request = {}) => ({
      success: true,
      platform: request.platform,
      providers: { [request.platform ?? "twitch"]: "complete" },
      data: [fixtures.stream({ platform: request.platform ?? "twitch" })],
    }));
    const { result } = renderHook(() => useInfiniteTopStreams(), { wrapper: makeWrapper() });

    expect(result.current.data).toEqual([]);
    expect(api.streams.getTop).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({
        initialized: true,
        preferences: { ...DEFAULT_USER_PREFERENCES, language: "es" },
      });
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "twitch",
      language: "es",
      limit: 12,
    });
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "kick",
      language: "es",
      limit: 12,
    });
  });

  it("continues a provider until it finds a stream in the selected language", async () => {
    useAuthStore.setState({
      initialized: true,
      preferences: { ...DEFAULT_USER_PREFERENCES, language: "es" },
    });
    const spanishStream = fixtures.stream({
      id: "spanish-stream",
      platform: "twitch",
      language: "es",
    });
    api.streams.getTop = vi.fn<typeof api.streams.getTop>(async (request = {}) => {
      if (request.platform === "kick") {
        return { success: true, platform: "kick", providers: { kick: "complete" }, data: [] };
      }
      if (request.cursor === "twitch-next") {
        return {
          success: true,
          platform: "twitch",
          providers: { twitch: "complete" },
          data: [spanishStream],
        };
      }
      return {
        success: true,
        platform: "twitch",
        providers: { twitch: "complete" },
        data: [],
        cursor: "twitch-next",
      };
    });

    const { result } = renderHook(() => useInfiniteTopStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual([spanishStream]));
    expect(api.streams.getTop).toHaveBeenCalledWith({
      platform: "twitch",
      language: "es",
      limit: 12,
      cursor: "twitch-next",
    });
  });

  it("keeps usable provider data when the other provider fails", async () => {
    const stream = fixtures.stream({ platform: "twitch", viewerCount: 42 });
    api.streams.getTop = vi.fn<typeof api.streams.getTop>(async (request = {}) => {
      const { platform } = request;
      if (platform === "kick") {
        return { success: false, platform, providers: { kick: "failed" }, error: "Kick down" };
      }
      return {
        success: true,
        platform,
        providers: { twitch: "complete" },
        data: [stream],
      };
    });

    const { result } = renderHook(() => useInfiniteTopStreams(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual([stream]));
    expect(result.current.error).toBeNull();
    expect(result.current.unavailablePlatforms).toEqual(["kick"]);
  });
});
