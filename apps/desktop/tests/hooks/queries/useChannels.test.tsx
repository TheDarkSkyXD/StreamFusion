import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { useChannelByUsername, useFollowedChannels } from "@/features/discovery/data/queries/useChannels";
import { resetPersistedChannelLruForTests } from "@/features/discovery/data/queries/persisted-channel-lru";
import { useFollowStore } from "@/store/follow-store";
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
  resetPersistedChannelLruForTests();
  useFollowStore.setState({ localFollows: [], sourceByKey: new Map(), isHydrated: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

// Guards: followed-channel IPC failures remain query errors so Following can distinguish retryable errors from a genuine zero-result response.
// Guards: useFollowedChannels stays idle when enabled=false — guest state must not fan out IPC on first render
// Guards: useChannelByUsername threads (username, platform) verbatim through IPC so a Kick lookup never accidentally hits Twitch
// Guards: fresh canonical channel lookups self-heal stale followed usernames through the follow-store boundary.
// Guards: resolved chat metadata is retained across restarts so Home and Stream chat do not repeat the channel-details waterfall.
describe("useFollowedChannels", () => {
  it("fetches followed channels for a platform", async () => {
    const ch = fixtures.channel({ username: "xqc" });
    api.channels.getFollowed = vi.fn(async () => ({ success: true as const, data: [ch] }));

    const { result } = renderHook(() => useFollowedChannels("twitch", { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].username).toBe("xqc");
  });

  it("dedupes duplicate same-platform channels from IPC by slug", async () => {
    api.channels.getFollowed = vi.fn(async () => ({
      success: true as const,
      data: [
        fixtures.channel({
          platform: "kick",
          id: "channel-1",
          username: "hennytingzz",
          displayName: "hennytingzz",
          avatarUrl: "",
        }),
        fixtures.channel({
          platform: "kick",
          id: "user-21103818",
          username: "Hennytingzz",
          displayName: "Hennytingzz",
          avatarUrl: "https://example.com/hennytingzz.webp",
        }),
      ],
    }));

    const { result } = renderHook(() => useFollowedChannels("kick", { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      username: "Hennytingzz",
      avatarUrl: "https://example.com/hennytingzz.webp",
    });
  });

  it("returns an error when the followed-channel IPC request fails", async () => {
    api.channels.getFollowed = vi.fn(async () => ({ success: false as const, error: "auth" }));
    const { result } = renderHook(() => useFollowedChannels("kick", { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2_500 });
    expect(result.current.error).toEqual(new Error("auth"));
  });

  it("does not fetch when enabled=false", async () => {
    const { result } = renderHook(() => useFollowedChannels("twitch", { enabled: false }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

describe("useChannelByUsername", () => {
  it("fetches a channel by username and platform", async () => {
    const ch = fixtures.channel({ username: "ninja", displayName: "Ninja" });
    api.channels.getByUsername = vi.fn(async () => ({ success: true as const, data: ch }));

    const { result } = renderHook(() => useChannelByUsername("ninja", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.displayName).toBe("Ninja");
  });

  it("is disabled when username is empty", async () => {
    const { result } = renderHook(() => useChannelByUsername("", "twitch"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("passes correct arguments to the IPC call", async () => {
    api.channels.getByUsername = vi.fn(async () => ({
      success: true as const,
      data: fixtures.channel(),
    }));
    renderHook(() => useChannelByUsername("xqc", "kick"), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(api.channels.getByUsername).toHaveBeenCalledWith({
        username: "xqc",
        platform: "kick",
      })
    );
  });

  it("persists resolved channel metadata for restart chat hydration", async () => {
    const channel = fixtures.channel({
      platform: "kick",
      username: "fast-chat",
      chatroomId: 12345,
    });
    api.channels.getByUsername = vi.fn(async () => ({ success: true as const, data: channel }));

    const { result } = renderHook(() => useChannelByUsername("fast-chat", "kick"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(api.store.set).toHaveBeenCalledWith(
        "channel-metadata-lru:v1",
        expect.objectContaining({
          version: 1,
          entries: [expect.objectContaining({ platform: "kick", username: "fast-chat" })],
        })
      )
    );
  });

  it("repairs a stale Twitch username when the canonical channel lookup resolves", async () => {
    useFollowStore.setState({
      localFollows: [
        fixtures.channel({
          id: "123",
          platform: "twitch",
          username: "old-login",
          displayName: "Old Login",
        }),
      ],
    });
    const canonical = fixtures.channel({
      id: "123",
      platform: "twitch",
      username: "new-login",
      displayName: "New Login",
    });
    api.channels.getByUsername = vi.fn(async () => ({ success: true as const, data: canonical }));
    api.follows.getAll = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "twitch-row-1",
          platform: "twitch",
          channelId: "123",
          channelName: "old-login",
          displayName: "Old Login",
          profileImage: "",
          followedAt: "2026-01-01T00:00:00.000Z",
          source: "twitch",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "twitch-row-1",
          platform: "twitch",
          channelId: "123",
          channelName: "new-login",
          displayName: "New Login",
          profileImage: canonical.avatarUrl,
          followedAt: "2026-01-01T00:00:00.000Z",
          source: "twitch",
        },
      ]);

    renderHook(() => useChannelByUsername("old-login", "twitch"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(api.follows.update).toHaveBeenCalledWith("twitch-row-1", {
        channelId: "123",
        channelName: "new-login",
        displayName: "New Login",
        profileImage: canonical.avatarUrl,
      })
    );
  });
});
