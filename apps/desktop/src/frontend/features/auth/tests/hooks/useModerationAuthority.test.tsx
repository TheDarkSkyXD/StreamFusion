import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChannelToolAccess } from "@/features/moderation/composition/channel-tool-access";

import {
  MODERATION_AUTHORITY_FRESH_MS,
  useModerationAuthority,
} from "@/features/moderation/components/hooks/useModerationAuthority";
import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useDevModOverrideStore } from "@/features/moderation/components/state/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/features/moderation/components/state/moderated-channels-store";
import { useReconnectDialogStore } from "@/features/auth/components/state/reconnect-dialog-store";
import { installElectronAPIMock } from "../../../../../../tests/test-utils";

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
// Guards: a same-channel live role refresh must not send an already-authorized workspace back through checking.
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

  // Guards against an unrelated missing grant locking every moderation tool.
  it("keeps verified moderator access and requests only the selected tool's missing scope", async () => {
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
      scopes: ["chat:read", "moderator:manage:banned_users"],
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    await waitFor(() => expect(result.current.state).toBe("authorized"));
    if (result.current.state !== "authorized") throw new Error("expected authorization");
    const authority = result.current;
    expect(authority.grantedScopes).toEqual(["chat:read", "moderator:manage:banned_users"]);
    const access = getChannelToolAccess(authority.grantedScopes, false);
    expect(access.bans).toMatchObject({ canRead: true, canManage: true });
    expect(access.unban.canRead).toBe(false);
    act(() => authority.requestScopes(access.unban.missingReadScopes));
    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      platform: "twitch",
      missingScopes: ["moderator:read:unban_requests"],
    });
    expect(result.current.state).toBe("authorized");
  });

  it("keeps Twitch moderation authorized when an old valid token is missing only AutoMod scope", async () => {
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
      scopes: TWITCH_APP_SCOPES.filter((scope) => scope !== "moderator:manage:automod"),
    });

    const { result } = renderHook(() => useModerationAuthority("twitch", "channel-1", "streamer"));

    await waitFor(() => expect(result.current.state).toBe("authorized"));
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

  it("does not re-check Kick own-broadcaster scopes when chat refreshes the same channel role snapshot", async () => {
    const states: string[] = [];
    useAuthStore.setState({ kickUser: kickUser() });
    tokenStatus.mockResolvedValue({
      platform: "kick",
      connected: true,
      valid: true,
      userId: "42",
      scopes: [...KICK_APP_SCOPES],
    });

    const { result } = renderHook(() => {
      const authority = useModerationAuthority("kick", "42", "modbob");
      useEffect(() => {
        states.push(authority.state);
      }, [authority.state]);
      return authority;
    });

    await waitFor(() => expect(result.current.state).toBe("authorized"));
    expect(tokenStatus).toHaveBeenCalledTimes(1);

    act(() => {
      useModeratedChannelsStore.getState().setKickAuthorityResult("modbob", {
        state: "complete",
        isModerator: true,
        checkedAt: Date.now(),
        source: "kick-channel-me",
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("authorized");
    expect(tokenStatus).toHaveBeenCalledTimes(1);
    expect(states.slice(states.indexOf("authorized") + 1)).not.toContain("checking");
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
