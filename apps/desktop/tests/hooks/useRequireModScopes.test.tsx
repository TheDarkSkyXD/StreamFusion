import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRequireModScopes } from "@/features/auth/data/useRequireModScopes";
import {
  TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES,
  TWITCH_MOD_ACTION_SCOPES,
} from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

function installElectronAPIMock(tokenScope: string[] | null) {
  Object.assign(window, {
    electronAPI: {
      auth: {
        tokenStatus: vi.fn().mockResolvedValue({
          platform: "twitch",
          connected: tokenScope !== null,
          valid: tokenScope !== null,
          scopes: tokenScope ?? [],
        }),
      },
    },
  });
}

beforeEach(() => {
  // Reset zustand stores between tests.
  useReconnectDialogStore.setState({ isOpen: false, missingScopes: [], onReconnected: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRequireModScopes", () => {
  it("returns hasModScopes=false and loading=false when no twitchUser is signed in", async () => {
    useAuthStore.setState({ twitchUser: null });
    installElectronAPIMock([]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(false);
  });

  it("returns hasModScopes=true when token carries both required scopes", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    installElectronAPIMock([
      "user:read:email",
      "user:read:moderated_channels",
      "moderator:manage:chat_messages",
    ]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(true);
  });

  it("keeps normal mod actions enabled while blocking EventSub when its full scope set is absent", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    installElectronAPIMock([...TWITCH_MOD_ACTION_SCOPES]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(true);
    expect(result.current.hasChannelModerateEventSubScopes).toBe(false);
    expect(result.current.missingChannelModerateEventSubScopes).toEqual(
      TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES.filter(
        (scope) => !new Set<string>(TWITCH_MOD_ACTION_SCOPES).has(scope)
      )
    );
  });

  it("accepts the documented read/manage alternatives for EventSub scope groups", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    installElectronAPIMock([
      "moderator:manage:blocked_terms",
      "moderator:manage:chat_settings",
      "moderator:manage:unban_requests",
      "moderator:read:banned_users",
      "moderator:read:chat_messages",
      "moderator:read:warnings",
      "moderator:read:moderators",
      "moderator:read:vips",
    ]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasChannelModerateEventSubScopes).toBe(true);
    expect(result.current.missingChannelModerateEventSubScopes).toEqual([]);
  });

  it("returns hasModScopes=false when token is missing user:read:moderated_channels", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    installElectronAPIMock(["user:read:email", "moderator:manage:chat_messages"]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(false);
  });

  it("returns hasModScopes=false when token is missing moderator:manage:chat_messages", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    installElectronAPIMock(["user:read:email", "user:read:moderated_channels"]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(false);
  });

  it("returns hasModScopes=false when the token fetch throws", async () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00Z",
        broadcasterType: "",
      },
    });
    Object.assign(window, {
      electronAPI: {
        auth: { tokenStatus: vi.fn().mockRejectedValue(new Error("nope")) },
      },
    });

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(false);
  });

  it("promptReconnect opens the reconnect dialog store", async () => {
    useAuthStore.setState({ twitchUser: null });
    installElectronAPIMock([]);

    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(useReconnectDialogStore.getState().isOpen).toBe(false);
    result.current.promptReconnect();
    const state = useReconnectDialogStore.getState();
    expect(state.isOpen).toBe(true);
    // No-arg call defaults to the shared pin-path list.
    expect(state.missingScopes).toEqual([...TWITCH_MOD_ACTION_SCOPES]);
  });

  it("promptReconnect forwards explicit missingScopes + onReconnected callback", async () => {
    useAuthStore.setState({ twitchUser: null });
    installElectronAPIMock([]);

    const onReconnected = vi.fn();
    const { result } = renderHook(() => useRequireModScopes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.promptReconnect({
      missingScopes: ["channel:manage:raids", "channel:manage:polls"],
      onReconnected,
    });

    const state = useReconnectDialogStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.missingScopes).toEqual(["channel:manage:raids", "channel:manage:polls"]);
    expect(state.onReconnected).toBeTypeOf("function");

    // The registered callback fires exactly once via fireReconnected.
    state.fireReconnected();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it("keeps promptReconnect stable across rerenders so subscription effects do not churn", async () => {
    useAuthStore.setState({ twitchUser: null });
    installElectronAPIMock([]);

    const { result, rerender } = renderHook(() => useRequireModScopes());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.promptReconnect;

    rerender();

    expect(result.current.promptReconnect).toBe(first);
  });
});
