import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useIsTwitchMod } from "@/hooks/useIsTwitchMod";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

beforeEach(() => {
  useAuthStore.setState({ twitchUser: null });
  useModeratedChannelsStore.setState({ twitchModeratedChannelIds: new Set() });
  useDevModOverrideStore.getState().reset();
});

describe("useIsTwitchMod", () => {
  it("returns false when no twitchUser is signed in", () => {
    const { result } = renderHook(() => useIsTwitchMod("c1"));
    expect(result.current).toBe(false);
  });

  it("returns false when channelId is null", () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    const { result } = renderHook(() => useIsTwitchMod(null));
    expect(result.current).toBe(false);
  });

  it("returns false when channelId is undefined", () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    const { result } = renderHook(() => useIsTwitchMod(undefined));
    expect(result.current).toBe(false);
  });

  it("returns true when the user IS the broadcaster", () => {
    useAuthStore.setState({
      twitchUser: {
        id: "42",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    const { result } = renderHook(() => useIsTwitchMod("42"));
    expect(result.current).toBe(true);
  });

  it("returns true when the user is in the moderated channels set", () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["c1", "c2"]),
    });
    const { result } = renderHook(() => useIsTwitchMod("c1"));
    expect(result.current).toBe(true);
  });

  it("returns false when the user is not a mod and not the broadcaster", () => {
    useAuthStore.setState({
      twitchUser: {
        id: "1",
        login: "me",
        displayName: "Me",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    useModeratedChannelsStore.setState({
      twitchModeratedChannelIds: new Set(["c2"]),
    });
    const { result } = renderHook(() => useIsTwitchMod("c1"));
    expect(result.current).toBe(false);
  });

  it("returns true when forceModRole is enabled (dev override)", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    const { result } = renderHook(() => useIsTwitchMod("anything"));
    expect(result.current).toBe(true);
  });
});
