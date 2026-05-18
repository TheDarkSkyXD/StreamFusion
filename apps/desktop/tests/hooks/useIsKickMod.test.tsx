import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useIsKickMod } from "@/hooks/useIsKickMod";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

beforeEach(() => {
  useDevModOverrideStore.getState().reset();
  useAuthStore.setState({ kickUser: null });
});

afterEach(() => {
  useDevModOverrideStore.getState().reset();
  useAuthStore.setState({ kickUser: null });
});

describe("useIsKickMod", () => {
  it("returns false when no Kick user is signed in", () => {
    const { result } = renderHook(() => useIsKickMod("ac7ionman"));
    expect(result.current).toBe(false);
  });

  it("returns false for null/empty channelSlug", () => {
    useAuthStore.setState({
      kickUser: { id: 1, username: "me", slug: "me", profilePic: "" },
    });
    expect(renderHook(() => useIsKickMod(null)).result.current).toBe(false);
    expect(renderHook(() => useIsKickMod("")).result.current).toBe(false);
  });

  it("returns true when the signed-in user is the broadcaster (slug match)", () => {
    useAuthStore.setState({
      kickUser: { id: 1, username: "Ac7ionMan", slug: "ac7ionman", profilePic: "" },
    });
    const { result } = renderHook(() => useIsKickMod("ac7ionman"));
    expect(result.current).toBe(true);
  });

  it("matches case-insensitively on both slug and channelSlug", () => {
    useAuthStore.setState({
      kickUser: { id: 1, username: "Ac7ionMan", slug: "Ac7ionMan", profilePic: "" },
    });
    expect(renderHook(() => useIsKickMod("AC7IONMAN")).result.current).toBe(true);
  });

  it("falls back to username match when slug doesn't match (legacy accounts)", () => {
    useAuthStore.setState({
      kickUser: { id: 1, username: "ac7ionman", slug: "legacy-slug-mismatch", profilePic: "" },
    });
    const { result } = renderHook(() => useIsKickMod("ac7ionman"));
    expect(result.current).toBe(true);
  });

  it("returns false for non-broadcaster channels", () => {
    useAuthStore.setState({
      kickUser: { id: 1, username: "me", slug: "me", profilePic: "" },
    });
    const { result } = renderHook(() => useIsKickMod("ac7ionman"));
    expect(result.current).toBe(false);
  });

  it("returns true when forceModRole is set regardless of user identity", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    expect(renderHook(() => useIsKickMod("any-channel")).result.current).toBe(true);
    // Even with null channel.
    expect(renderHook(() => useIsKickMod(null)).result.current).toBe(true);
  });
});
