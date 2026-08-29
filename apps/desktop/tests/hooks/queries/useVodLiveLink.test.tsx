import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VOD_LIVE_LINK_KEYS, useVodLiveLink } from "@/features/playback/data/useVodLiveLink";
import { fixtures, installElectronAPIMock } from "../../test-utils";

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
});

afterEach(() => {
  vi.useRealTimers();
});

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Guards: cached live status stays hidden until the current VOD mount receives fresh authority
// Guards: a later offline poll removes Watch Live without borrowing channel metadata
describe("useVodLiveLink", () => {
  it("does not expose cached live status before a fresh offline response", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    client.setQueryData(
      VOD_LIVE_LINK_KEYS.byChannel("ninja", "twitch"),
      fixtures.stream({ channelName: "ninja" })
    );
    let resolveStatus: ((value: { success: true; data: null }) => void) | undefined;
    api.streams.getByChannel = vi.fn(
      () =>
        new Promise<{ success: true; data: null }>((resolve) => {
          resolveStatus = resolve;
        })
    );

    const { result } = renderHook(() => useVodLiveLink("ninja", "twitch"), {
      wrapper: wrapperFor(client),
    });

    expect(result.current).toEqual({ kind: "checking" });
    resolveStatus?.({ success: true, data: null });
    await waitFor(() => expect(result.current).toEqual({ kind: "unavailable" }));
  });

  it("removes availability when the next foreground poll reports offline", async () => {
    vi.useFakeTimers();
    api.streams.getByChannel = vi
      .fn<typeof api.streams.getByChannel>()
      .mockResolvedValueOnce({
        success: true,
        data: fixtures.stream({ channelName: "ninja" }),
      })
      .mockResolvedValueOnce({ success: true, data: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });

    const { result } = renderHook(() => useVodLiveLink("ninja", "twitch"), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ kind: "available" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ kind: "unavailable" });
    expect(api.streams.getByChannel).toHaveBeenCalledTimes(2);
  });
});
