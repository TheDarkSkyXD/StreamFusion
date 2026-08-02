import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { hydratePersistedFollowingSnapshot } from "@/hooks/queries/browse-snapshot-bootstrap";
import {
  STREAM_KEYS,
  removeFollowedStreamFromCache,
  useFollowedStreams,
  useStreamByChannel,
  useTopStreams,
} from "@/hooks/queries/useStreams";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Guards: useFollowedStreams swallows error responses and returns [] so a Helix 5xx doesn't break the home grid into a query-error boundary the user can't recover from
// Guards: useFollowedStreams stays idle when enabled=false — the followed grid must not fan out IPC during the guest-state initial render
// Guards: query keys honor (platform, limit) / (username, platform) so the cache doesn't return cross-platform or wrong-channel data
// Guards: followed-stream cache data collapses duplicate platform-scoped broadcaster slugs even when IPC ids differ
// Guards: a successful empty live refresh removes the prior persisted result so stale live cards cannot return after restart
// Guards: a live result completed during delayed startup persists immediately once the authoritative identity settles
// Guards: Kick live status refreshes every 15 seconds in followed surfaces and every 10 seconds on an open channel, while Twitch keeps its existing conservative cadence.
// Guards: confirmed offline status removes only the matching Kick channel from both followed-stream caches so the sidebar changes state immediately without disturbing other platforms.
describe("useTopStreams", () => {
  it("fetches top streams", async () => {
    const stream = fixtures.stream();
    api.streams.getTop = vi.fn(async () => ({ data: [stream], error: null }));

    const { result } = renderHook(() => useTopStreams(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].channelName).toBe("testchannel");
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
  it("refreshes Kick followed status every 15 seconds", async () => {
    vi.useFakeTimers();
    api.streams.getFollowed = vi.fn(async () => ({ data: [], error: null }));

    renderHook(() => useFollowedStreams("kick", 20, { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await act(async () => Promise.resolve());
    expect(api.streams.getFollowed).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(api.streams.getFollowed).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.streams.getFollowed).toHaveBeenCalledTimes(2);
  });

  it("fetches followed streams", async () => {
    const stream = fixtures.stream();
    api.streams.getFollowed = vi.fn(async () => ({ data: [stream], error: null }));

    const { result } = renderHook(() => useFollowedStreams(undefined, 20, { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("returns empty array on error instead of throwing", async () => {
    api.streams.getFollowed = vi.fn(async () => ({ data: null, error: "auth" }));
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: true, snapshotIdentity: identity }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(api.store.delete).not.toHaveBeenCalled();
  });

  it("does not fetch when enabled=false", async () => {
    const { result } = renderHook(() => useFollowedStreams(undefined, 20, { enabled: false }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("deduplicates followed streams by platform and broadcaster slug", async () => {
    api.streams.getFollowed = vi.fn(async () => ({
      data: [
        fixtures.stream({
          id: "remote-live",
          platform: "kick",
          channelId: "kick-user-id",
          channelName: "xqc",
        }),
        fixtures.stream({
          id: "public-live",
          platform: "kick",
          channelId: "kick-channel-id",
          channelName: "XQC",
        }),
      ],
      error: null,
    }));

    const { result } = renderHook(() => useFollowedStreams("kick", 20, { enabled: true }), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("persists a successful followed-stream result under its exact identity", async () => {
    const stream = fixtures.stream({ id: "restart-live" });
    api.streams.getFollowed = vi.fn(async () => ({ data: [stream], error: null }));
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;

    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: true, snapshotIdentity: identity }),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.store.set).toHaveBeenCalledWith(
      "browse-query-snapshot:v1:followed-streams:all",
      expect.objectContaining({
        version: 1,
        identity: JSON.stringify(identity),
        data: [stream],
      })
    );
  });

  it("persists an already-successful startup result when identity later settles", async () => {
    const stream = fixtures.stream({ id: "startup-live" });
    api.streams.getFollowed = vi.fn(async () => ({ data: [stream], error: null }));
    const identity = {
      platform: "all",
      twitchUserId: "settled-viewer",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    const initialProps: { snapshotIdentity: typeof identity | undefined } = {
      snapshotIdentity: undefined,
    };

    const { result, rerender } = renderHook(
      ({ snapshotIdentity }: { snapshotIdentity: typeof identity | undefined }) =>
        useFollowedStreams(undefined, 20, { enabled: true, snapshotIdentity }),
      { initialProps, wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.store.set).not.toHaveBeenCalled();

    rerender({ snapshotIdentity: identity });

    await waitFor(() =>
      expect(api.store.set).toHaveBeenCalledWith(
        "browse-query-snapshot:v1:followed-streams:all",
        expect.objectContaining({ identity: JSON.stringify(identity), data: [stream] })
      )
    );
    expect(api.streams.getFollowed).toHaveBeenCalledTimes(1);
  });

  it("prevents stale live cards from resurrecting after a successful empty refresh and restart", async () => {
    const identity = {
      platform: "all",
      twitchUserId: "viewer-1",
      kickUserId: "guest",
      follows: ["twitch:channel-1"],
    } as const;
    const slot = "browse-query-snapshot:v1:followed-streams:all";
    const snapshots = new Map<string, unknown>([
      [
        slot,
        {
          version: 1,
          identity: JSON.stringify(identity),
          savedAt: Date.now(),
          data: [fixtures.stream({ id: "previously-live" })],
        },
      ],
    ]);
    api.store.get = vi.fn(async (key: string) => snapshots.get(key) ?? null);
    api.store.delete = vi.fn(async (key: string) => {
      snapshots.delete(key);
    });
    api.streams.getFollowed = vi.fn(async () => ({ data: [], error: null }));

    const { result } = renderHook(
      () => useFollowedStreams(undefined, 20, { enabled: true, snapshotIdentity: identity }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(snapshots.has(slot)).toBe(false));

    const restartedClient = new QueryClient();
    await hydratePersistedFollowingSnapshot(restartedClient, identity);

    expect(restartedClient.getQueryData(STREAM_KEYS.followed())).toBeUndefined();
  });
});

describe("useStreamByChannel", () => {
  it("refreshes an open Kick channel status every 10 seconds", async () => {
    vi.useFakeTimers();
    api.streams.getByChannel = vi.fn(async () => ({ data: null, error: null }));

    renderHook(() => useStreamByChannel("jollyirl", "kick"), {
      wrapper: makeWrapper(),
    });
    await act(async () => Promise.resolve());
    expect(api.streams.getByChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(api.streams.getByChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.streams.getByChannel).toHaveBeenCalledTimes(2);
  });

  it("fetches a single stream by channel", async () => {
    const stream = fixtures.stream({ channelName: "xqc" });
    api.streams.getByChannel = vi.fn(async () => ({ data: stream, error: null }));

    const { result } = renderHook(() => useStreamByChannel("xqc", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.channelName).toBe("xqc");
  });

  it("is disabled when username is empty", async () => {
    const { result } = renderHook(() => useStreamByChannel("", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

describe("removeFollowedStreamFromCache", () => {
  it("removes the finished Kick channel from platform and combined followed caches", () => {
    const client = new QueryClient();
    const jollyKick = fixtures.stream({
      id: "kick-jolly",
      platform: "kick",
      channelName: "JollyIRL",
    });
    const jollyTwitch = fixtures.stream({
      id: "twitch-jolly",
      platform: "twitch",
      channelName: "jollyirl",
    });
    const otherKick = fixtures.stream({
      id: "kick-other",
      platform: "kick",
      channelName: "other",
    });
    client.setQueryData(STREAM_KEYS.followed("kick"), [jollyKick, otherKick]);
    client.setQueryData(STREAM_KEYS.followed(), [jollyKick, jollyTwitch, otherKick]);

    removeFollowedStreamFromCache(client, "kick", "jollyirl");

    expect(client.getQueryData(STREAM_KEYS.followed("kick"))).toEqual([otherKick]);
    expect(client.getQueryData(STREAM_KEYS.followed())).toEqual([jollyTwitch, otherKick]);
  });
});
