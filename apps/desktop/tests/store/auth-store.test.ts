import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports, so spies must come from
// vi.hoisted to be reachable from inside the factory closure.
const { removeQueriesSpy, invalidateQueriesSpy, followStoreHydrateSpy } = vi.hoisted(() => ({
  removeQueriesSpy: vi.fn(),
  invalidateQueriesSpy: vi.fn(),
  followStoreHydrateSpy: vi.fn(async () => {}),
}));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { removeQueries: removeQueriesSpy, invalidateQueries: invalidateQueriesSpy },
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: {
    getState: () => ({ hydrate: followStoreHydrateSpy }),
  },
}));

import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { DEFAULT_USER_PREFERENCES, type KickUser, type TwitchUser } from "@/shared/auth-types";
import type { AuthStatus } from "@/shared/ipc-channels";
import { useAuthStore } from "@/store/auth-store";

const initialAuthState = useAuthStore.getState();

beforeEach(() => {
  removeQueriesSpy.mockReset();
  invalidateQueriesSpy.mockReset();
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
  Reflect.deleteProperty(window, "electronAPI");
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

  it("keeps the authenticated UI when backend logout cleanup reports failure", async () => {
    const logoutTwitch = vi.fn(async () => ({ success: false, error: "cleanup failed" }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { logoutTwitch } },
    });

    await useAuthStore.getState().logoutTwitch();

    expect(useAuthStore.getState()).toMatchObject({
      twitchConnected: true,
      twitchLoading: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Failed to logout from Twitch",
        platform: "twitch",
      },
    });
    expect(useAuthStore.getState().twitchUser).not.toBeNull();
    expect(removeQueriesSpy).not.toHaveBeenCalled();
    expect(followStoreHydrateSpy).not.toHaveBeenCalled();
  });

  it("shows an honest pending state immediately, then disconnects before follow re-hydration finishes", async () => {
    let finishLogout!: () => void;
    let finishHydrate!: () => void;
    const logoutPending = new Promise<void>((resolve) => {
      finishLogout = resolve;
    });
    const hydratePending = new Promise<void>((resolve) => {
      finishHydrate = resolve;
    });
    const logoutTwitch = vi.fn(async () => {
      await logoutPending;
      return { success: true };
    });
    followStoreHydrateSpy.mockReturnValueOnce(hydratePending);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { logoutTwitch } },
    });

    const logoutPromise = useAuthStore.getState().logoutTwitch();

    expect(useAuthStore.getState()).toMatchObject({
      twitchConnected: true,
      twitchLoading: true,
    });

    finishLogout();
    await vi.waitFor(() => expect(followStoreHydrateSpy).toHaveBeenCalledTimes(1));

    expect(useAuthStore.getState()).toMatchObject({
      twitchConnected: false,
      twitchUser: null,
      twitchLoading: false,
    });

    finishHydrate();
    await logoutPromise;
  });
});

// Guards: Twitch device login must expose distinct opening, authorization-waiting, and finalizing phases instead of appearing frozen on one generic label.
describe("auth-store Twitch device login progress", () => {
  it("tracks device-flow status until the refreshed disconnected state settles", async () => {
    let finishLogin!: () => void;
    let statusListener!: (data: { status: string; message?: string }) => void;
    const loginPending = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });
    const unsubscribe = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          openTwitchLogin: vi.fn(async () => loginPending),
          onDeviceCodeStatus: vi.fn(
            (listener: (data: { status: string; message?: string }) => void) => {
              statusListener = listener;
              return unsubscribe;
            }
          ),
          getStatus: vi.fn(async () => ({
            twitch: { connected: false, user: null, hasToken: false, isExpired: false },
            kick: { connected: false, user: null, hasToken: false, isExpired: false },
            isGuest: true,
          })),
        },
      },
    });

    const loginPromise = useAuthStore.getState().loginTwitch();
    const phase = () => useAuthStore.getState().twitchAuthPhase;

    expect(phase()).toBe("opening");
    statusListener({ status: "pending", message: "Waiting" });
    expect(phase()).toBe("waiting");
    statusListener({ status: "authorized", message: "Authorized" });
    expect(phase()).toBe("finishing");

    finishLogin();
    await loginPromise;

    expect(phase()).toBeNull();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("leaves the pending state and surfaces an error when the final auth refresh fails", async () => {
    useAuthStore.setState({ twitchConnected: false, twitchUser: null });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          openTwitchLogin: vi.fn(async () => {}),
          onDeviceCodeStatus: vi.fn(() => vi.fn()),
          getStatus: vi.fn(async () => {
            throw new Error("status unavailable");
          }),
        },
      },
    });

    await useAuthStore.getState().loginTwitch();

    expect(useAuthStore.getState()).toMatchObject({
      twitchLoading: false,
      twitchAuthPhase: null,
      error: { platform: "twitch" },
    });
  });
});

describe("auth-store logoutKick — follow-cache cleanup", () => {
  beforeEach(() => {
    // Re-seed for a logged-in Kick session (the outer beforeEach seeds Twitch).
    useAuthStore.setState({
      ...initialAuthState,
      twitchUser: null,
      twitchConnected: false,
      kickUser: { id: "k1", username: "kuser", displayName: "KUser" } as never,
      kickConnected: true,
      kickLoading: false,
      isGuest: false,
    });
    const authStub = {
      logoutKick: vi.fn(async () => ({ success: true })),
      clearToken: vi.fn(async () => {}),
      clearKickUser: vi.fn(async () => {}),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: authStub },
    });
  });

  it("removes the cached followed-channels query for kick", async () => {
    await useAuthStore.getState().logoutKick();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_KEYS.followed("kick"),
    });
  });

  it("removes the cached followed-streams query so stale Kick live-streams stop rendering", async () => {
    await useAuthStore.getState().logoutKick();

    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed(),
    });
  });

  it("re-hydrates the follow-store so in-memory account Kick follows drop to guest", async () => {
    await useAuthStore.getState().logoutKick();

    expect(followStoreHydrateSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the logoutKick IPC (end-to-end backend teardown) — not the legacy clearToken/clearKickUser path", async () => {
    // Regression guard: an earlier draft of this flow called the individual
    // clearToken + clearKickUser IPCs, which left kick.com session cookies
    // alive in the default Electron session. The single logoutKick call wires
    // through to kickAuthService.logout() which also clears those cookies.
    await useAuthStore.getState().logoutKick();

    const auth = (
      window as unknown as { electronAPI: { auth: { logoutKick: ReturnType<typeof vi.fn> } } }
    ).electronAPI.auth;
    expect(auth.logoutKick).toHaveBeenCalledTimes(1);
  });

  it("flips kickConnected to false and clears kickUser after the cache cleanup", async () => {
    await useAuthStore.getState().logoutKick();

    expect(useAuthStore.getState().kickConnected).toBe(false);
    expect(useAuthStore.getState().kickUser).toBeNull();
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
        syncFollows: vi.fn(async () => ({ success: true })),
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

  it("Kick OAuth expiry preserves the remembered identity for website chat", async () => {
    const ctl = makeAuthApiCapture();
    const kickUser: KickUser = {
      id: 42,
      username: "kick-user",
      slug: "kick-user",
      profilePic: "",
      verified: false,
    };
    await useAuthStore.getState().initializeAuth();
    useAuthStore.setState({ kickUser, kickConnected: true, isGuest: false });

    ctl.triggerKickSessionExpired();

    expect(useAuthStore.getState()).toMatchObject({
      kickUser,
      kickConnected: false,
      isGuest: false,
    });
  });
});

// Guards: a transient Twitch refresh failure during startup must not erase the backend-owned saved session.
// Guards: permanent startup auth loss must keep Twitch identity and require reconnect even when the auth-lost event fires before listener registration.
// Guards: a thrown Twitch refresh error during startup must preserve the backend-owned token and identity.
describe("auth-store Twitch startup persistence", () => {
  const twitchUser: TwitchUser = {
    id: "u1",
    login: "u",
    displayName: "U",
    profileImageUrl: "https://example.test/twitch-user.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    broadcasterType: "",
  };

  it("preserves a saved expired Twitch session when refresh fails transiently", async () => {
    const status: AuthStatus = {
      twitch: {
        connected: false,
        user: twitchUser,
        hasToken: true,
        isExpired: true,
      },
      kick: { connected: false, user: null, hasToken: false, isExpired: false },
      isGuest: false,
    };
    const clearToken = vi.fn(async () => {});
    const clearTwitchUser = vi.fn(async () => {});
    const getStatus = vi.fn(async () => status);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          getStatus,
          refreshTwitchToken: vi.fn(async () => ({
            success: false,
            error: "temporary upstream failure",
          })),
          clearToken,
          clearTwitchUser,
          onTwitchAuthLost: vi.fn(() => () => {}),
          onKickSessionExpired: vi.fn(() => () => {}),
          onFollowsSynced: vi.fn(() => () => {}),
          syncFollows: vi.fn(async () => ({ success: true })),
        },
        follows: { getAll: vi.fn(async () => []) },
        preferences: { get: vi.fn(async () => ({})) },
      },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchUser: null,
      twitchConnected: false,
      twitchReconnectRequired: false,
    });

    await useAuthStore.getState().initializeAuth();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(clearToken).not.toHaveBeenCalled();
    expect(clearTwitchUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: false,
      isGuest: false,
      error: null,
      initialized: true,
    });
  });

  it("keeps Twitch identity and requires reconnect after permanent startup auth loss", async () => {
    const expiredStatus: AuthStatus = {
      twitch: {
        connected: false,
        user: twitchUser,
        hasToken: true,
        isExpired: true,
      },
      kick: { connected: false, user: null, hasToken: false, isExpired: false },
      isGuest: false,
    };
    const authLostStatus: AuthStatus = {
      twitch: {
        connected: false,
        user: twitchUser,
        hasToken: false,
        isExpired: false,
      },
      kick: { connected: false, user: null, hasToken: false, isExpired: false },
      isGuest: true,
    };
    let twitchAuthLostListener: (() => void) | null = null;
    const getStatus = vi
      .fn<() => Promise<AuthStatus>>()
      .mockResolvedValueOnce(expiredStatus)
      .mockResolvedValueOnce(authLostStatus);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          getStatus,
          refreshTwitchToken: vi.fn(async () => {
            twitchAuthLostListener?.();
            return { success: false, error: "authorization revoked" };
          }),
          clearToken: vi.fn(async () => {}),
          clearTwitchUser: vi.fn(async () => {}),
          onTwitchAuthLost: vi.fn((listener: () => void) => {
            twitchAuthLostListener = listener;
            return () => {};
          }),
          onKickSessionExpired: vi.fn(() => () => {}),
          onFollowsSynced: vi.fn(() => () => {}),
          syncFollows: vi.fn(async () => ({ success: true })),
        },
        follows: { getAll: vi.fn(async () => []) },
        preferences: { get: vi.fn(async () => ({})) },
      },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchUser: null,
      twitchConnected: false,
      twitchReconnectRequired: false,
    });

    await useAuthStore.getState().initializeAuth();

    expect(useAuthStore.getState()).toMatchObject({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: true,
      initialized: true,
      error: {
        code: "TOKEN_EXPIRED",
        platform: "twitch",
      },
    });
  });

  it("preserves a saved Twitch session when startup refresh throws transiently", async () => {
    const status: AuthStatus = {
      twitch: {
        connected: false,
        user: twitchUser,
        hasToken: true,
        isExpired: true,
      },
      kick: { connected: false, user: null, hasToken: false, isExpired: false },
      isGuest: false,
    };
    const clearToken = vi.fn(async () => {});
    const clearTwitchUser = vi.fn(async () => {});
    const getStatus = vi.fn(async () => status);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          getStatus,
          refreshTwitchToken: vi.fn(async () => {
            throw new Error("temporary network failure");
          }),
          clearToken,
          clearTwitchUser,
          onTwitchAuthLost: vi.fn(() => () => {}),
          onKickSessionExpired: vi.fn(() => () => {}),
          onFollowsSynced: vi.fn(() => () => {}),
          syncFollows: vi.fn(async () => ({ success: true })),
        },
        follows: { getAll: vi.fn(async () => []) },
        preferences: { get: vi.fn(async () => ({})) },
      },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchUser: null,
      twitchConnected: false,
      twitchReconnectRequired: false,
    });

    await useAuthStore.getState().initializeAuth();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(clearToken).not.toHaveBeenCalled();
    expect(clearTwitchUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: false,
      isGuest: false,
      error: null,
      initialized: true,
    });
  });
});

// Guards: a thrown Kick refresh error during startup must preserve backend-owned OAuth, website auth, and identity.
describe("auth-store Kick startup persistence", () => {
  it("reconciles authoritative status without clearing credentials in the renderer", async () => {
    const kickUser: KickUser = {
      id: 42,
      username: "kick-user",
      slug: "kick-user",
      profilePic: "",
      verified: false,
    };
    const status: AuthStatus = {
      twitch: { connected: false, user: null, hasToken: false, isExpired: false },
      kick: {
        connected: false,
        user: kickUser,
        hasToken: true,
        isExpired: true,
      },
      isGuest: false,
    };
    const clearToken = vi.fn(async () => {});
    const clearKickUser = vi.fn(async () => {});
    const getStatus = vi.fn(async () => status);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          getStatus,
          refreshKickToken: vi.fn(async () => {
            throw new Error("temporary network failure");
          }),
          clearToken,
          clearKickUser,
          onTwitchAuthLost: vi.fn(() => () => {}),
          onKickSessionExpired: vi.fn(() => () => {}),
          onFollowsSynced: vi.fn(() => () => {}),
          syncFollows: vi.fn(async () => ({ success: true })),
        },
        follows: { getAll: vi.fn(async () => []) },
        preferences: { get: vi.fn(async () => ({})) },
      },
    });
    useAuthStore.setState({
      ...initialAuthState,
      kickUser: null,
      kickConnected: false,
    });

    await useAuthStore.getState().initializeAuth();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(clearToken).not.toHaveBeenCalled();
    expect(clearKickUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      kickUser,
      kickConnected: false,
      isGuest: false,
      initialized: true,
      error: null,
    });
  });
});

describe("auth-store account-follow startup sync", () => {
  // Guards: restart preserves persisted Kick follows without opening the platform's
  // full website fallback. Twitch's lightweight API sync still runs at startup.
  function installAuthApi(status: AuthStatus) {
    let followsSyncedCb:
      | ((data: {
          platform: "twitch" | "kick";
          addedCount?: number;
          removedCount?: number;
        }) => void)
      | null = null;
    const api = {
      auth: {
        getStatus: vi.fn(async () => status),
        refreshTwitchToken: vi.fn(async () => ({ success: true })),
        refreshKickToken: vi.fn(async () => ({ success: true })),
        clearToken: vi.fn(async () => {}),
        clearTwitchUser: vi.fn(async () => {}),
        clearKickUser: vi.fn(async () => {}),
        onTwitchAuthLost: vi.fn(() => () => {}),
        onKickSessionExpired: vi.fn(() => () => {}),
        onFollowsSynced: vi.fn(
          (
            cb: (data: {
              platform: "twitch" | "kick";
              addedCount?: number;
              removedCount?: number;
            }) => void
          ) => {
            followsSyncedCb = cb;
            return () => {};
          }
        ),
        syncFollows: vi.fn(async () => ({ success: true })),
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
      api,
      triggerFollowsSynced: (data: {
        platform: "twitch" | "kick";
        addedCount?: number;
        removedCount?: number;
      }) => {
        if (!followsSyncedCb) throw new Error("onFollowsSynced not registered");
        followsSyncedCb(data);
      },
    };
  }

  it("does not run the browser-capable Kick follow sync during cold start", async () => {
    const { api } = installAuthApi({
      twitch: { connected: false, user: null, hasToken: false, isExpired: false },
      kick: {
        connected: true,
        user: { id: "k1", username: "kickuser", displayName: "KickUser" } as never,
        hasToken: true,
        isExpired: false,
      },
      isGuest: false,
    });

    await useAuthStore.getState().initializeAuth();

    expect(api.auth.onFollowsSynced).toHaveBeenCalledOnce();
    expect(api.auth.syncFollows).not.toHaveBeenCalled();
  });

  it("invalidates Kick followed channels and streams when Kick sync completes", async () => {
    const { triggerFollowsSynced } = installAuthApi({
      twitch: { connected: false, user: null, hasToken: false, isExpired: false },
      kick: {
        connected: true,
        user: { id: "k1", username: "kickuser", displayName: "KickUser" } as never,
        hasToken: true,
        isExpired: false,
      },
      isGuest: false,
    });

    await useAuthStore.getState().initializeAuth();
    triggerFollowsSynced({ platform: "kick", addedCount: 0, removedCount: 0 });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: CHANNEL_KEYS.followed("kick"),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed("kick"),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: STREAM_KEYS.followed(),
    });
  });
});

describe("auth-store manual account-follow sync", () => {
  it("syncs both connected platforms", async () => {
    const syncFollows = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { syncFollows } },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchConnected: true,
      kickConnected: true,
    });

    const result = await useAuthStore.getState().syncConnectedFollows();

    expect(syncFollows).toHaveBeenCalledWith("twitch");
    expect(syncFollows).toHaveBeenCalledWith("kick");
    expect(result).toEqual({ synced: ["twitch", "kick"], failed: [], failureReasons: {} });
  });

  it("syncs only the connected platform", async () => {
    const syncFollows = vi.fn(async () => ({ success: true }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { syncFollows } },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchConnected: true,
      kickConnected: false,
    });

    const result = await useAuthStore.getState().syncConnectedFollows();

    expect(syncFollows).toHaveBeenCalledOnce();
    expect(syncFollows).toHaveBeenCalledWith("twitch");
    expect(result).toEqual({ synced: ["twitch"], failed: [], failureReasons: {} });
  });

  it("returns partial failures and timestamps only successful platforms", async () => {
    const syncFollows = vi.fn(async (platform: "twitch" | "kick") => ({
      success: platform === "twitch",
    }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { syncFollows } },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchConnected: true,
      kickConnected: true,
      followSyncLastSyncedAt: {},
    });

    const result = await useAuthStore.getState().syncConnectedFollows();

    expect(result).toEqual({
      synced: ["twitch"],
      failed: ["kick"],
      failureReasons: { kick: undefined },
    });
    expect(useAuthStore.getState().followSyncLastSyncedAt.twitch).toEqual(expect.any(String));
    expect(useAuthStore.getState().followSyncLastSyncedAt.kick).toBeUndefined();
  });

  it("reports full failure without hydrating follows", async () => {
    const syncFollows = vi.fn(async () => ({ success: false }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { syncFollows } },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchConnected: true,
      kickConnected: true,
    });

    const result = await useAuthStore.getState().syncConnectedFollows();

    expect(result).toEqual({
      synced: [],
      failed: ["twitch", "kick"],
      failureReasons: { twitch: undefined, kick: undefined },
    });
    expect(followStoreHydrateSpy).not.toHaveBeenCalled();
  });

  it("joins duplicate manual sync callers to the in-flight result", async () => {
    const resolveFirstSync: { current?: (value: { success: true }) => void } = {};
    const syncFollows = vi.fn(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolveFirstSync.current = resolve;
        })
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { auth: { syncFollows } },
    });
    useAuthStore.setState({
      ...initialAuthState,
      twitchConnected: true,
      kickConnected: false,
    });

    const first = useAuthStore.getState().syncConnectedFollows();
    expect(useAuthStore.getState().followSyncInProgress).toBe(true);
    const second = useAuthStore.getState().syncConnectedFollows();

    expect(second).toBe(first);
    expect(syncFollows).toHaveBeenCalledOnce();
    expect(resolveFirstSync.current).toBeDefined();
    resolveFirstSync.current?.({ success: true });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { synced: ["twitch"], failed: [], failureReasons: {} },
      { synced: ["twitch"], failed: [], failureReasons: {} },
    ]);
    expect(useAuthStore.getState().followSyncInProgress).toBe(false);
  });
});

// Guards: callers must be able to tell when a preference save failed, so optimistic UI state is not treated as persisted.
describe("auth-store preference persistence", () => {
  it("reports success and stores the preferences returned by IPC", async () => {
    const savedPreferences = {
      ...DEFAULT_USER_PREFERENCES,
      chat: { ...DEFAULT_USER_PREFERENCES.chat, fontScale: 1.2 },
    };
    const update = vi.fn(async () => savedPreferences);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { preferences: { update } },
    });
    useAuthStore.setState({ preferences: DEFAULT_USER_PREFERENCES });

    const result = await useAuthStore.getState().updatePreferences({
      chat: { ...DEFAULT_USER_PREFERENCES.chat, fontScale: 1.2 },
    });

    expect(result).toEqual({ success: true });
    expect(useAuthStore.getState().preferences).toEqual(savedPreferences);
  });

  it("reports IPC persistence rejection to the caller", async () => {
    const update = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: { preferences: { update } },
    });
    useAuthStore.setState({ preferences: DEFAULT_USER_PREFERENCES });

    const result = await useAuthStore.getState().updatePreferences({
      chat: { ...DEFAULT_USER_PREFERENCES.chat, fontScale: 1.1 },
    });

    expect(result).toEqual({ success: false });
  });
});
