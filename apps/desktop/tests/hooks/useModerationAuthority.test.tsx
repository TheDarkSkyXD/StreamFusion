import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MODERATION_AUTHORITY_FRESH_MS,
  useModerationAuthority,
} from "@/hooks/useModerationAuthority";
import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";
import { installElectronAPIMock } from "../test-utils";

const tokenStatus = vi.fn();

function twitchUser(id = "moderator-1") {
  return {
    id,
    login: "modbob",
    displayName: "ModBob",
    profileImageUrl: "",
    createdAt: "",
    broadcasterType: "" as const,
  };
}

function kickUser(id = 42) {
  return {
    id,
    username: "modbob",
    slug: "modbob",
    profilePic: "",
    verified: false,
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  tokenStatus.mockReset();
  tokenStatus.mockResolvedValue({
    platform: "twitch",
    connected: true,
    valid: true,
    userId: "moderator-1",
    scopes: [...TWITCH_APP_SCOPES],
  });
  const api = installElectronAPIMock();
  api.auth.tokenStatus = tokenStatus;
  api.auth.getToken = vi.fn().mockResolvedValue(null);
  api.kickChat.getViewerRole = vi.fn();
  window.electronAPI = api;
  useAuthStore.setState({ twitchUser: null, kickUser: null });
  useModeratedChannelsStore.getState().clear();
  useDevModOverrideStore.getState().reset();
  useReconnectDialogStore.setState({
    isOpen: false,
    platform: "twitch",
    phase: "idle",
    missingScopes: [],
    onReconnected: null,
  });
});

// Guards: authority is a discriminated Platform result, never badge-derived Set membership.
// Guards: stale, failed, partial, and token-validation failures fail closed.
// Guards: only a complete fresh negative can classify an authenticated account as an ordinary viewer.
describe("useModerationAuthority", () => {
  it.each(["twitch", "kick"] as const)("hides moderation for a %s guest", (platform) => {
    const { result } = renderHook(() => useModerationAuthority(platform, "channel-1", "streamer"));

    expect(result.current.state).toBe("hidden");
    expect(tokenStatus).not.toHaveBeenCalled();
  });

  it("keeps an unresolved Twitch authority check hidden behind checking", () => {
    useAuthStore.setState({ twitchUser: twitchUser() });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    expect(result.current.state).toBe("checking");
    expect(tokenStatus).not.toHaveBeenCalled();
  });

  it("authorizes only a fresh complete Twitch moderator result with live validated scopes", async () => {
    const checkedAt = Date.now();
    useAuthStore.setState({ twitchUser: twitchUser() });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["channel-1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    await waitFor(() => expect(result.current.state).toBe("authorized"));
  });

  it("keeps an explicit Electron development fixture authorized after auth hydration clears the user", async () => {
    window.history.replaceState({}, "", "/?moderationFixture=history");
    useDevModOverrideStore.setState({
      forceModRole: true,
      forceModScopes: true,
      forceResolvedTwitchBroadcasterId: "fixture-channel",
    });
    useAuthStore.setState({ twitchUser: null });

    const { result } = renderHook(() =>
      useModerationAuthority("twitch", "fixture-channel", "streamer")
    );

    await waitFor(() => expect(result.current.state).toBe("authorized"));
    expect(tokenStatus).not.toHaveBeenCalled();
  });

  // Guards: a mounted moderation surface must fail closed when its authority proof expires.
  it("automatically changes a mounted authorized surface to unverifiable at expiry", async () => {
    vi.useFakeTimers();
    try {
      const checkedAt = new Date("2026-07-30T12:00:00.000Z").getTime();
      vi.setSystemTime(checkedAt);
      useAuthStore.setState({ twitchUser: twitchUser() });
      useModeratedChannelsStore.setState({
        twitchModeratedChannelIds: new Set(["channel-1"]),
        hydratedAt: checkedAt,
        hydrating: false,
        twitchAuthority: { state: "complete", checkedAt },
      });

      const { result } = renderHook(() =>
        useModerationAuthority("twitch", "channel-1", "streamer")
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.state).toBe("authorized");

      act(() => {
        vi.advanceTimersByTime(MODERATION_AUTHORITY_FRESH_MS);
      });
      expect(result.current.state).toBe("unverifiable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects stale cached-positive Twitch authority", () => {
    const checkedAt = Date.now() - MODERATION_AUTHORITY_FRESH_MS - 1;
    useAuthStore.setState({ twitchUser: twitchUser() });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["channel-1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    expect(result.current.state).toBe("unverifiable");
    expect(tokenStatus).not.toHaveBeenCalled();
  });

  it.each(["failed", "partial"] as const)(
    "rejects a %s Twitch authority result even when an old Set still contains the channel",
    (state) => {
      useAuthStore.setState({ twitchUser: twitchUser() });
      useModeratedChannelsStore.setState({
        twitchModeratedChannelIds: new Set(["channel-1"]),
        hydratedAt: Date.now(),
        hydrating: false,
        twitchAuthority: {
          state,
          checkedAt: Date.now(),
          reason: state === "partial" ? "page-cap" : "network",
        },
      });

      const { result } = renderHook(() =>
        useModerationAuthority("twitch", "channel-1", "streamer")
      );

      expect(result.current.state).toBe("unverifiable");
      expect(tokenStatus).not.toHaveBeenCalled();
    }
  );

  it("hides moderation only after a fresh complete Twitch viewer result", () => {
    const checkedAt = Date.now();
    useAuthStore.setState({ twitchUser: twitchUser() });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    expect(result.current.state).toBe("hidden");
    expect(tokenStatus).not.toHaveBeenCalled();
  });

  it("shows one reconnect state containing every missing canonical scope", async () => {
    const checkedAt = Date.now();
    useAuthStore.setState({ twitchUser: twitchUser() });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["channel-1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });
    tokenStatus.mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      userId: "moderator-1",
      scopes: ["chat:read"],
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    await waitFor(() => expect(result.current.state).toBe("reconnect-required"));
    if (result.current.state !== "reconnect-required") throw new Error("expected reconnect");
    expect(result.current.missingScopes).toEqual(
      TWITCH_APP_SCOPES.filter((scope) => scope !== "chat:read")
    );
  });

  it("treats live token-status failure as unverifiable rather than missing scopes", async () => {
    const checkedAt = Date.now();
    useAuthStore.setState({ twitchUser: twitchUser() });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["channel-1"]),
      hydratedAt: checkedAt,
      hydrating: false,
      twitchAuthority: { state: "complete", checkedAt },
    });
    tokenStatus.mockRejectedValue(new Error("IPC unavailable"));

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    await waitFor(() => expect(result.current.state).toBe("unverifiable"));
  });

  it("authorizes a Kick broadcaster using authenticated Platform identity and introspected scopes", async () => {
    useAuthStore.setState({ kickUser: kickUser() });
    tokenStatus.mockResolvedValue({
      platform: "kick",
      connected: true,
      valid: true,
      userId: "42",
      scopes: [...KICK_APP_SCOPES],
    });

    const { result } = renderHook(() => useModerationAuthority("kick", "42", "modbob"));

    await waitFor(() => expect(result.current.state).toBe("authorized"));
  });

  it("uses a fresh Kick channel-me result for moderator authority and ignores badge hints", async () => {
    useAuthStore.setState({ kickUser: kickUser() });
    tokenStatus.mockResolvedValue({
      platform: "kick",
      connected: true,
      valid: true,
      userId: "42",
      scopes: [...KICK_APP_SCOPES],
    });
    act(() => {
      useModeratedChannelsStore.getState().setKickChannelModState("streamer", true);
    });
    const unresolved = renderHook(() => useModerationAuthority("kick", "channel-1", "streamer"));
    expect(unresolved.result.current.state).toBe("checking");
    unresolved.unmount();

    act(() => {
      useModeratedChannelsStore.getState().setKickAuthorityResult("streamer", {
        state: "complete",
        isModerator: true,
        checkedAt: Date.now(),
        source: "kick-channel-me",
      });
    });
    const resolved = renderHook(() => useModerationAuthority("kick", "channel-1", "streamer"));

    await waitFor(() => expect(resolved.result.current.state).toBe("authorized"));
  });

  it("hides moderation only after a fresh complete Kick viewer result", () => {
    useAuthStore.setState({ kickUser: kickUser() });
    act(() => {
      useModeratedChannelsStore.getState().setKickAuthorityResult("streamer", {
        state: "complete",
        isModerator: false,
        checkedAt: Date.now(),
        source: "kick-channel-me",
      });
    });

    const { result } = renderHook(() => useModerationAuthority("kick", "channel-1", "streamer"));

    expect(result.current.state).toBe("hidden");
    expect(tokenStatus).not.toHaveBeenCalled();
  });
});
