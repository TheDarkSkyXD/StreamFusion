import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useFollowedStreams, useStreamByChannel, useTopStreams } from "@/hooks/queries/useStreams";
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

describe("useTopStreams", () => {
  it("fetches top streams", async () => {
    const stream = fixtures.stream();
    api.streams.getTop = vi.fn(async () => ({ data: [stream], error: null }));

    const { result } = renderHook(() => useTopStreams(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].channelName).toBe("testchannel");
  });

  it("throws when the response contains an error", async () => {
    api.streams.getTop = vi.fn(async () => ({ data: null, error: "down" }));
    const { result } = renderHook(() => useTopStreams(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("passes platform and limit to the IPC call", async () => {
    api.streams.getTop = vi.fn(async () => ({ data: [], error: null }));
    renderHook(() => useTopStreams("kick", 10), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(api.streams.getTop).toHaveBeenCalledWith({ platform: "kick", limit: 10 })
    );
  });
});

describe("useFollowedStreams", () => {
  it("fetches followed streams", async () => {
    const stream = fixtures.stream();
    api.streams.getFollowed = vi.fn(async () => ({ data: [stream], error: null }));

    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: true }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("returns empty array on error instead of throwing", async () => {
    api.streams.getFollowed = vi.fn(async () => ({ data: null, error: "auth" }));
    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: true }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("does not fetch when enabled=false", async () => {
    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: false }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

describe("useStreamByChannel", () => {
  it("fetches a single stream by channel", async () => {
    const stream = fixtures.stream({ channelName: "xqc" });
    api.streams.getByChannel = vi.fn(async () => ({ data: stream, error: null }));

    const { result } = renderHook(
      () => useStreamByChannel("xqc", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.channelName).toBe("xqc");
  });

  it("throws on error response", async () => {
    api.streams.getByChannel = vi.fn(async () => ({ data: null, error: "offline" }));
    const { result } = renderHook(
      () => useStreamByChannel("ghost", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("is disabled when username is empty", async () => {
    const { result } = renderHook(
      () => useStreamByChannel("", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});
