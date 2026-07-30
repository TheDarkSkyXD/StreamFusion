import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";

import { installElectronAPIMock } from "../../../../test-utils";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubEnv("VITE_TWITCH_CLIENT_ID", "configured-client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Guards: public profile reads stay behind the typed preload bridge so Electron and browser development use the same privileged implementation.
// Guards: Kick profile fields use the same typed bridge and independent retry behavior.
describe("useUserProfile", () => {
  it("resolves Twitch fields through the privileged profile bridge without renderer fetches", async () => {
    const api = installElectronAPIMock();
    api.userProfiles.getTwitchIdentity = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: {
        userId: "19789903",
        username: "streamfusiondev",
        displayName: "StreamFusionDev",
        avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/me.png",
      },
    }));
    api.userProfiles.getTwitchAccountCreated = vi.fn(async () => ({
      state: "known" as const,
      source: "first-party-fallback" as const,
      value: "2011-06-06T00:00:00Z",
    }));
    api.userProfiles.getTwitchFollow = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: "2026-01-01T00:00:00Z",
    }));
    api.userProfiles.resolveTwitchChannel = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: { id: "42", username: "channel", displayName: "Channel" },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useUserProfile("19789903", "twitch", "42", "streamfusiondev", "channel"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.profile?.displayName).toBe("StreamFusionDev"));

    expect(api.userProfiles.getTwitchIdentity).toHaveBeenCalledWith({
      userId: "19789903",
      username: "streamfusiondev",
    });
    expect(api.userProfiles.getTwitchAccountCreated).toHaveBeenCalledWith({
      userId: "19789903",
      username: "streamfusiondev",
    });
    expect(api.userProfiles.getTwitchFollow).toHaveBeenCalledWith({
      broadcasterId: "42",
      userId: "19789903",
      username: "streamfusiondev",
    });
    expect(api.userProfiles.resolveTwitchChannel).toHaveBeenCalledWith({
      username: "streamfusiondev",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries an independently failed account-created field without refetching identity", async () => {
    const api = installElectronAPIMock();
    api.userProfiles.getTwitchIdentity = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
      },
    }));
    api.userProfiles.getTwitchAccountCreated = vi
      .fn()
      .mockResolvedValueOnce({ state: "failed", message: "Couldn’t verify" })
      .mockResolvedValueOnce({
        state: "known",
        source: "first-party-fallback",
        value: "2011-06-06T00:00:00Z",
      });
    api.userProfiles.getTwitchFollow = vi.fn(async () => ({
      state: "negative" as const,
      source: "official" as const,
    }));
    api.userProfiles.resolveTwitchChannel = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: { id: "u1", username: "alice", displayName: "Alice" },
    }));

    const { result } = renderHook(() => useUserProfile("u1", "twitch", "c1", "alice", "streamer"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.accountCreated.state).toBe("failed"));

    await act(async () => result.current.retryAccountCreated());
    await waitFor(() => expect(result.current.accountCreated.state).toBe("known"));

    expect(api.userProfiles.getTwitchAccountCreated).toHaveBeenCalledTimes(2);
    expect(api.userProfiles.getTwitchIdentity).toHaveBeenCalledTimes(1);
  });

  it("resolves Kick identity while unsupported dates settle independently", async () => {
    const api = installElectronAPIMock();
    api.userProfiles.getKickIdentity = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: {
        userId: "123",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "https://files.kick.com/alice.webp",
      },
    }));
    api.userProfiles.getKickAccountCreated = vi.fn(async () => ({
      state: "unavailable" as const,
      message: "Unavailable",
    }));
    api.userProfiles.getKickFollow = vi.fn(async () => ({
      state: "unavailable" as const,
      message: "Unavailable",
    }));
    api.userProfiles.resolveKickChannel = vi.fn(async () => ({
      state: "known" as const,
      source: "official" as const,
      value: { id: "123", username: "alice", displayName: "Alice" },
    }));

    const { result } = renderHook(() => useUserProfile("u1", "kick", "c1", "alice", "streamer"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.identity.state).toBe("known"));
    expect(result.current.loading).toBe(false);
    expect(result.current.accountCreated).toEqual({
      state: "unavailable",
      message: "Unavailable",
    });
    expect(result.current.follow).toEqual({ state: "unavailable", message: "Unavailable" });
    expect(result.current.channel.state).toBe("known");

    act(() => {
      result.current.retryIdentity();
      result.current.retryAccountCreated();
      result.current.retryFollow();
      result.current.retryChannel();
    });

    expect(api.userProfiles.getKickIdentity).toHaveBeenCalledWith({
      userId: "u1",
      username: "alice",
      channelSlug: "streamer",
    });
    expect(api.userProfiles.getKickAccountCreated).toHaveBeenCalledTimes(2);
    expect(api.userProfiles.getKickFollow).toHaveBeenCalledTimes(2);
    expect(api.userProfiles.resolveKickChannel).toHaveBeenCalledTimes(2);
    expect(api.userProfiles.getTwitchIdentity).not.toHaveBeenCalled();
    expect(api.userProfiles.getTwitchAccountCreated).not.toHaveBeenCalled();
    expect(api.userProfiles.getTwitchFollow).not.toHaveBeenCalled();
    expect(api.userProfiles.resolveTwitchChannel).not.toHaveBeenCalled();
  });
});
