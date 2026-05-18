import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIsTwitchMod } from "@/hooks/useIsTwitchMod";
import { useRequireModScopes } from "@/hooks/useRequireModScopes";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

beforeEach(() => {
  useDevModOverrideStore.getState().reset();
  useAuthStore.setState({ twitchUser: null });
  Object.assign(window, {
    electronAPI: {
      auth: { getToken: vi.fn().mockResolvedValue({ accessToken: "tok", scope: [] }) },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useDevModOverrideStore.getState().reset();
});

describe("dev mod-override → useIsTwitchMod", () => {
  it("returns false by default (no override, no twitch user)", () => {
    const { result } = renderHook(() => useIsTwitchMod("channel-123"));
    expect(result.current).toBe(false);
  });

  it("returns true when forceModRole is set, even without a twitch user / channelId", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    const { result: r1 } = renderHook(() => useIsTwitchMod("any-channel"));
    expect(r1.current).toBe(true);
    // Even with null/empty channelId the override wins — useful when the
    // debug panel toggles it before any channel is mounted.
    const { result: r2 } = renderHook(() => useIsTwitchMod(null));
    expect(r2.current).toBe(true);
  });

  it("reverts to real check after override is cleared", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    const { result, rerender } = renderHook(() => useIsTwitchMod("c-1"));
    expect(result.current).toBe(true);
    useDevModOverrideStore.getState().setForceModRole(false);
    rerender();
    expect(result.current).toBe(false);
  });
});

describe("dev mod-override → useRequireModScopes", () => {
  it("returns hasModScopes=true and loading=false instantly when forceModScopes is set", () => {
    useDevModOverrideStore.getState().setForceModScopes(true);
    const { result } = renderHook(() => useRequireModScopes());
    expect(result.current.hasModScopes).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("falls back to real scope check when override is off", async () => {
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
    // Empty scopes → real check returns false
    const { result } = renderHook(() => useRequireModScopes());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasModScopes).toBe(false);
  });
});
