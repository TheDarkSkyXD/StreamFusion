import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports, so spies must come from
// vi.hoisted to be reachable from inside the factory closure.
const { removeQueriesSpy, followStoreHydrateSpy } = vi.hoisted(() => ({
  removeQueriesSpy: vi.fn(),
  followStoreHydrateSpy: vi.fn(async () => {}),
}));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { removeQueries: removeQueriesSpy },
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: {
    getState: () => ({ hydrate: followStoreHydrateSpy }),
  },
}));

import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { useAuthStore } from "@/store/auth-store";

const initialAuthState = useAuthStore.getState();

beforeEach(() => {
  removeQueriesSpy.mockReset();
  followStoreHydrateSpy.mockReset();
  followStoreHydrateSpy.mockResolvedValue(undefined);

  // Reset auth store to a logged-in Twitch session so logoutTwitch has work
  // to do and isn't short-circuited by an in-flight loading guard.
  useAuthStore.setState({
    ...initialAuthState,
    twitchUser: { id: "u1", login: "u", displayName: "U" } as never,
    twitchConnected: true,
    twitchLoading: false,
    twitchReconnectRequired: false,
    kickUser: null,
    kickConnected: false,
    isGuest: false,
  });

  const authStub = {
    logoutTwitch: vi.fn(async () => ({ success: true })),
    clearToken: vi.fn(async () => {}),
    clearKickUser: vi.fn(async () => {}),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: { auth: authStub },
  });
});

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: cleanup of test stub
  delete (window as any).electronAPI;
});

describe("auth-store logoutTwitch — follow-cache cleanup", () => {
  it("removes the cached followed-channels query for twitch", async () => {
    await useAuthStore.getState().logoutTwitch();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_KEYS.followed("twitch"),
    });
  });

  it("removes the cached followed-streams query so stale Twitch live-streams stop rendering", async () => {
    await useAuthStore.getState().logoutTwitch();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed(),
    });
  });

  it("re-hydrates the follow-store from the (now-cleared) DB so in-memory account follows are dropped", async () => {
    await useAuthStore.getState().logoutTwitch();

    expect(followStoreHydrateSpy).toHaveBeenCalledTimes(1);
  });

  it("still flips twitchConnected to false after the cache cleanup", async () => {
    await useAuthStore.getState().logoutTwitch();

    expect(useAuthStore.getState().twitchConnected).toBe(false);
    expect(useAuthStore.getState().twitchUser).toBeNull();
  });
});
