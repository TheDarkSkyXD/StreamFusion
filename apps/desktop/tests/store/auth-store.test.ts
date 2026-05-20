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

describe("auth-store session-expired listeners — follow-cache cleanup", () => {
  // Capture the listener callbacks registered inside initializeAuth so we can
  // trigger them as the main process would. The auth IPC surface is intentionally
  // stubbed minimal — initializeAuth only reaches as far as the listener wiring
  // when status calls resolve, so we wire stable fakes for everything it touches.
  function makeAuthApiCapture() {
    let twitchAuthLostCb: (() => void) | null = null;
    let kickSessionExpiredCb: (() => void) | null = null;
    const api = {
      auth: {
        getStatus: vi.fn(async () => ({
          twitch: { connected: false, user: null, hasToken: false, isExpired: false },
          kick: { connected: false, user: null, hasToken: false, isExpired: false },
          isGuest: true,
        })),
        refreshTwitchToken: vi.fn(async () => ({ success: true })),
        refreshKickToken: vi.fn(async () => ({ success: true })),
        clearToken: vi.fn(async () => {}),
        clearTwitchUser: vi.fn(async () => {}),
        clearKickUser: vi.fn(async () => {}),
        onTwitchAuthLost: vi.fn((cb: () => void) => {
          twitchAuthLostCb = cb;
        }),
        onKickSessionExpired: vi.fn((cb: () => void) => {
          kickSessionExpiredCb = cb;
        }),
        // Wired in initializeAuth alongside the session-expired listeners.
        // Tests in this file don't exercise the post-login sync path, so
        // a no-op register is enough — the listener is registered but never
        // invoked here.
        onFollowsSynced: vi.fn(() => () => {}),
      },
      follows: { getAll: vi.fn(async () => []) },
      preferences: { get: vi.fn(async () => ({})) },
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: api,
    });
    return {
      triggerTwitchAuthLost: () => {
        if (!twitchAuthLostCb) throw new Error("onTwitchAuthLost not registered");
        twitchAuthLostCb();
      },
      triggerKickSessionExpired: () => {
        if (!kickSessionExpiredCb) throw new Error("onKickSessionExpired not registered");
        kickSessionExpiredCb();
      },
    };
  }

  it("Twitch session expired fires the same cache cleanup as explicit logout", async () => {
    const ctl = makeAuthApiCapture();
    await useAuthStore.getState().initializeAuth();

    ctl.triggerTwitchAuthLost();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_KEYS.followed("twitch"),
    });
    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed(),
    });
    expect(followStoreHydrateSpy).toHaveBeenCalled();
  });

  it("Twitch session expired keeps twitchUser for the reconnect affordance", async () => {
    const ctl = makeAuthApiCapture();
    // Seed a user before initialize so we can check the listener preserves it
    useAuthStore.setState({
      ...initialAuthState,
      twitchUser: { id: "u1", login: "u", displayName: "U" } as never,
      twitchConnected: true,
    });
    await useAuthStore.getState().initializeAuth();
    // initializeAuth syncs from getStatus which returns no user; seed again
    useAuthStore.setState({
      twitchUser: { id: "u1", login: "u", displayName: "U" } as never,
      twitchConnected: true,
    });

    ctl.triggerTwitchAuthLost();

    expect(useAuthStore.getState().twitchUser).not.toBeNull();
    expect(useAuthStore.getState().twitchConnected).toBe(false);
    expect(useAuthStore.getState().twitchReconnectRequired).toBe(true);
  });

  it("Kick session expired fires cache cleanup for kick", async () => {
    const ctl = makeAuthApiCapture();
    await useAuthStore.getState().initializeAuth();

    ctl.triggerKickSessionExpired();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_KEYS.followed("kick"),
    });
    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed(),
    });
    expect(followStoreHydrateSpy).toHaveBeenCalled();
  });
});
