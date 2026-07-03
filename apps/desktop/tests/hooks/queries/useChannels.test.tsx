import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useChannelByUsername, useFollowedChannels } from "@/hooks/queries/useChannels";
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

// Guards: useFollowedChannels swallows error responses and returns [] so a Helix auth failure doesn't break the followed sidebar into a query-error boundary
// Guards: useFollowedChannels stays idle when enabled=false — guest state must not fan out IPC on first render
// Guards: useChannelByUsername threads (username, platform) verbatim through IPC so a Kick lookup never accidentally hits Twitch
describe("useFollowedChannels", () => {
  it("fetches followed channels for a platform", async () => {
    const ch = fixtures.channel({ username: "xqc" });
    api.channels.getFollowed = vi.fn(async () => ({ data: [ch], error: null }));

    const { result } = renderHook(
      () => useFollowedChannels("twitch", { enabled: true }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].username).toBe("xqc");
  });

  it("dedupes duplicate same-platform channels from IPC by slug", async () => {
    api.channels.getFollowed = vi.fn(async () => ({
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
      error: null,
    }));

    const { result } = renderHook(
      () => useFollowedChannels("kick", { enabled: true }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      username: "Hennytingzz",
      avatarUrl: "https://example.com/hennytingzz.webp",
    });
  });

  it("returns empty array on error instead of throwing", async () => {
    api.channels.getFollowed = vi.fn(async () => ({ data: null, error: "auth" }));
    const { result } = renderHook(
      () => useFollowedChannels("kick", { enabled: true }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("does not fetch when enabled=false", async () => {
    const { result } = renderHook(
      () => useFollowedChannels("twitch", { enabled: false }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

describe("useChannelByUsername", () => {
  it("fetches a channel by username and platform", async () => {
    const ch = fixtures.channel({ username: "ninja", displayName: "Ninja" });
    api.channels.getByUsername = vi.fn(async () => ({ data: ch, error: null }));

    const { result } = renderHook(
      () => useChannelByUsername("ninja", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.displayName).toBe("Ninja");
  });

  it("is disabled when username is empty", async () => {
    const { result } = renderHook(
      () => useChannelByUsername("", "twitch"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });

  it("passes correct arguments to the IPC call", async () => {
    api.channels.getByUsername = vi.fn(async () => ({
      data: fixtures.channel(),
      error: null,
    }));
    renderHook(
      () => useChannelByUsername("xqc", "kick"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() =>
      expect(api.channels.getByUsername).toHaveBeenCalledWith({
        username: "xqc",
        platform: "kick",
      })
    );
  });
});
