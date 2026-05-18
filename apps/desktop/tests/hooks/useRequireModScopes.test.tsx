import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRequireModScopes } from "@/hooks/useRequireModScopes";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

interface MockedTokenShape {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
}

function installElectronAPIMock(tokenScope: string[] | null) {
  const token: MockedTokenShape | null =
    tokenScope === null
      ? null
      : {
          accessToken: "tok",
          refreshToken: "ref",
          expiresAt: Date.now() + 3_600_000,
          scope: tokenScope,
        };
  Object.assign(window, {
    electronAPI: {
      auth: {
        getToken: vi.fn().mockResolvedValue(token),
      },
    },
  });
}

beforeEach(() => {
  // Reset zustand stores between tests.
  useReconnectDialogStore.setState({ isOpen: false });
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
        auth: { getToken: vi.fn().mockRejectedValue(new Error("nope")) },
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
    expect(useReconnectDialogStore.getState().isOpen).toBe(true);
  });
});
