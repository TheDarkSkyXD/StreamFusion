import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";
import { BrowserWindow } from "electron";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getToken: vi.fn(),
  saveToken: vi.fn(),
  clearToken: vi.fn(),
  hasToken: vi.fn(),
  isTokenExpired: vi.fn(),
  saveTwitchUser: vi.fn(),
  saveKickUser: vi.fn(),
  ensureKickToken: vi.fn(),
  disposeKickSendWindow: vi.fn(),
  kickLogout: vi.fn(),
  twitchLogout: vi.fn(),
  refreshTwitchToken: vi.fn(),
  getValidTwitchToken: vi.fn(),
  runTwitchDeviceCodeLogin: vi.fn(),
  openTwitchDeviceAuthWindow: vi.fn(),
  getKickFollows: vi.fn(),
  writeKickFollow: vi.fn(),
  upsertSyncedFollows: vi.fn(),
  intervals: [] as Array<() => void>,
  windowListeners: new Map<string, () => void>(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn((callback: () => void) => {
    mocks.intervals.push(callback);
    return { stop: vi.fn() };
  }),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/follow-endpoints", () => ({
  getAllFollowedChannels: mocks.getKickFollows,
  writeKickAccountFollow: mocks.writeKickFollow,
}));

vi.mock("@/backend/auth", () => ({
  authWindowManager: {
    openAuthWindow: vi.fn(),
    closeAuthWindow: vi.fn(),
  },
  deviceCodeFlowService: {
    requestDeviceCode: vi.fn(),
    pollForToken: vi.fn(),
    stopPolling: vi.fn(),
  },
  getOAuthConfig: vi.fn(() => ({ clientId: "client", scopes: [] })),
  kickAuthService: {
    on: vi.fn(),
    ensureValidToken: mocks.ensureKickToken,
    logout: mocks.kickLogout,
    refreshToken: vi.fn(),
    fetchCurrentUser: vi.fn(),
  },
  oauthCallbackServer: { stop: vi.fn(), waitForCallback: vi.fn() },
  tokenExchangeService: { exchangeCodeForToken: vi.fn() },
  twitchAuthService: {
    setAuthLostHandler: vi.fn(),
    scheduleProactiveRefresh: vi.fn(),
    logout: mocks.twitchLogout,
    refreshToken: mocks.refreshTwitchToken,
    getValidAccessToken: mocks.getValidTwitchToken,
    fetchCurrentUser: vi.fn(),
  },
  validateOAuthConfig: vi.fn(() => []),
}));

vi.mock("@/backend/auth/device-code-flow", () => ({
  runTwitchDeviceCodeLogin: mocks.runTwitchDeviceCodeLogin,
}));

vi.mock("@/backend/auth/twitch-device-auth-window", () => ({
  twitchDeviceAuthWindow: { open: mocks.openTwitchDeviceAuthWindow },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getToken: mocks.getToken,
    saveToken: mocks.saveToken,
    clearToken: mocks.clearToken,
    clearAllTokens: vi.fn(),
    hasToken: mocks.hasToken,
    isTokenExpired: mocks.isTokenExpired,
    getTwitchUser: vi.fn(() => null),
    saveTwitchUser: mocks.saveTwitchUser,
    clearTwitchUser: vi.fn(),
    getKickUser: vi.fn(() => null),
    saveKickUser: mocks.saveKickUser,
    clearKickUser: vi.fn(),
    upsertSyncedFollows: mocks.upsertSyncedFollows,
  },
}));

vi.mock("@/backend/services/live-notification-service", () => ({
  liveNotificationService: { reconcileSilently: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  disposeSendWindow: mocks.disposeKickSendWindow,
}));

import { registerAuthHandlers } from "@/backend/ipc/handlers/auth-handlers";

const allowedEvent = { senderFrame: { url: "file:///app/index.html" } };
const rejectedEvent = { senderFrame: { url: "https://evil.example/" } };

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = mocks.handlers.get(channel);
  if (!registered) throw new Error(`Missing handler ${channel}`);
  return registered;
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.getToken.mockReset().mockReturnValue(null);
  mocks.saveToken.mockReset();
  mocks.clearToken.mockReset();
  mocks.hasToken.mockReset().mockReturnValue(false);
  mocks.isTokenExpired.mockReset().mockReturnValue(false);
  mocks.saveTwitchUser.mockReset();
  mocks.saveKickUser.mockReset();
  mocks.ensureKickToken.mockReset();
  mocks.disposeKickSendWindow.mockReset();
  mocks.kickLogout.mockReset();
  mocks.twitchLogout.mockReset();
  mocks.refreshTwitchToken.mockReset();
  mocks.getValidTwitchToken.mockReset();
  mocks.runTwitchDeviceCodeLogin.mockReset();
  mocks.openTwitchDeviceAuthWindow.mockReset();
  mocks.getKickFollows.mockReset().mockResolvedValue({
    status: "ok",
    channels: [],
    canPruneAbsent: true,
  });
  mocks.upsertSyncedFollows.mockReset().mockReturnValue({
    accountCount: 0,
    pendingCount: 0,
    addedCount: 0,
    removedCount: 0,
  });
  mocks.intervals.length = 0;
  mocks.windowListeners.clear();
  const authWindow = Object.assign(new BrowserWindow(), {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
    on: vi.fn((event: string, listener: () => void) => {
      mocks.windowListeners.set(event, listener);
    }),
  });
  registerAuthHandlers(authWindow);
});

// Guards: generic token storage remains Kick-only and rejects untrusted renderer origins without exposing a credential.
// Guards: manual, interval, and post-startup focus Kick syncs can use the authenticated browser session fallback.
describe("auth IPC credential boundary", () => {
  it("runs manual Kick sync without granting permission to open a repair window", async () => {
    mocks.ensureKickToken.mockResolvedValue(true);
    const syncFollows = handler(IPC_CHANNELS.AUTH_SYNC_FOLLOWS);

    await syncFollows(allowedEvent, { platform: "kick" });

    expect(mocks.getKickFollows).toHaveBeenCalledWith({ allowBrowserWindowFallback: true });
  });

  it("runs the periodic Kick refresh through the authenticated browser fallback", async () => {
    mocks.hasToken.mockImplementation((platform: string) => platform === "kick");

    mocks.intervals[0]?.();

    await vi.waitFor(() => {
      expect(mocks.getKickFollows).toHaveBeenCalledWith({ allowBrowserWindowFallback: true });
    });
  });

  it("runs a post-startup Kick focus refresh through the authenticated browser fallback", async () => {
    mocks.hasToken.mockImplementation((platform: string) => platform === "kick");
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);

    mocks.windowListeners.get("focus")?.();

    await vi.waitFor(() => {
      expect(mocks.getKickFollows).toHaveBeenCalledWith({ allowBrowserWindowFallback: true });
    });
    dateNow.mockRestore();
  });
  it("collapses concurrent Twitch login requests into one device flow", async () => {
    let resolveLogin: (() => void) | undefined;
    mocks.runTwitchDeviceCodeLogin.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        })
    );
    const openTwitch = handler(IPC_CHANNELS.AUTH_OPEN_TWITCH);

    const first = openTwitch(allowedEvent);
    const second = openTwitch(allowedEvent);

    expect(mocks.runTwitchDeviceCodeLogin).toHaveBeenCalledTimes(1);
    resolveLogin?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);
  });

  it("returns Kick credentials only to an allowed sender and never returns Twitch credentials", async () => {
    const twitchToken = { accessToken: "twitch-secret" };
    const kickToken = { accessToken: "kick-token" };
    mocks.getToken.mockImplementation((platform: string) =>
      platform === "twitch" ? twitchToken : kickToken
    );
    const getToken = handler(IPC_CHANNELS.AUTH_GET_TOKEN);

    expect(getToken(allowedEvent, { platform: "kick" })).toBe(kickToken);
    expect(getToken(allowedEvent, { platform: "twitch" })).toBeNull();
    expect(getToken(rejectedEvent, { platform: "kick" })).toBeNull();
  });

  it("stores Kick credentials only and ignores Twitch or untrusted writes", () => {
    const saveToken = handler(IPC_CHANNELS.AUTH_SAVE_TOKEN);
    const kickToken = { accessToken: "kick-token" };

    saveToken(allowedEvent, { platform: "kick", token: kickToken });
    saveToken(allowedEvent, { platform: "twitch", token: { accessToken: "injected" } });
    saveToken(rejectedEvent, { platform: "kick", token: { accessToken: "evil" } });

    expect(mocks.saveToken).toHaveBeenCalledTimes(1);
    expect(mocks.saveToken).toHaveBeenCalledWith("kick", kickToken);
  });

  it("rejects missing or malformed token payloads without reading or writing storage", () => {
    const getToken = handler(IPC_CHANNELS.AUTH_GET_TOKEN);
    const saveToken = handler(IPC_CHANNELS.AUTH_SAVE_TOKEN);
    mocks.getToken.mockClear();
    mocks.saveToken.mockClear();

    expect(getToken(allowedEvent, undefined)).toBeNull();
    expect(getToken(allowedEvent, { platform: "youtube" })).toBeNull();
    saveToken(allowedEvent, undefined);
    saveToken(allowedEvent, { platform: "kick" });
    saveToken(allowedEvent, { platform: "kick", token: { accessToken: "" } });
    saveToken(allowedEvent, {
      platform: "kick",
      token: { accessToken: "kick-token", scope: ["user:read", 42] },
    });

    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.saveToken).not.toHaveBeenCalled();
  });

  it("rejects malformed platform payloads for token lifecycle operations", () => {
    const clearToken = handler(IPC_CHANNELS.AUTH_CLEAR_TOKEN);
    const hasToken = handler(IPC_CHANNELS.AUTH_HAS_TOKEN);
    const isTokenExpired = handler(IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED);
    mocks.clearToken.mockClear();
    mocks.hasToken.mockClear();
    mocks.isTokenExpired.mockClear();

    expect(clearToken(allowedEvent, undefined)).toBeUndefined();
    expect(hasToken(allowedEvent, { platform: "youtube" })).toBe(false);
    expect(isTokenExpired(allowedEvent, { platform: 42 })).toBe(true);

    expect(mocks.clearToken).not.toHaveBeenCalled();
    expect(mocks.hasToken).not.toHaveBeenCalled();
    expect(mocks.isTokenExpired).not.toHaveBeenCalled();
  });

  it("persists only runtime-valid Twitch and Kick user records", () => {
    const saveTwitchUser = handler(IPC_CHANNELS.AUTH_SAVE_TWITCH_USER);
    const saveKickUser = handler(IPC_CHANNELS.AUTH_SAVE_KICK_USER);
    const twitchUser = {
      id: "1",
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: "https://example.test/twitch.png",
      createdAt: "2024-01-01T00:00:00Z",
      broadcasterType: "affiliate",
    };
    const kickUser = {
      id: 2,
      username: "creator",
      slug: "creator",
      profilePic: "https://example.test/kick.png",
      verified: true,
    };

    saveTwitchUser(allowedEvent, { user: twitchUser });
    saveKickUser(allowedEvent, { user: kickUser });
    saveTwitchUser(allowedEvent, undefined);
    saveTwitchUser(allowedEvent, { user: { ...twitchUser, broadcasterType: "admin" } });
    saveKickUser(allowedEvent, { user: { ...kickUser, id: "2" } });
    saveKickUser(allowedEvent, { user: { ...kickUser, verified: "yes" } });

    expect(mocks.saveTwitchUser).toHaveBeenCalledTimes(1);
    expect(mocks.saveTwitchUser).toHaveBeenCalledWith(twitchUser);
    expect(mocks.saveKickUser).toHaveBeenCalledTimes(1);
    expect(mocks.saveKickUser).toHaveBeenCalledWith(kickUser);
  });

  it("rejects malformed platform payloads before follow sync or logout side effects", async () => {
    const syncFollows = handler(IPC_CHANNELS.AUTH_SYNC_FOLLOWS);
    const logout = handler(IPC_CHANNELS.AUTH_LOGOUT);

    await expect(syncFollows(allowedEvent, undefined)).resolves.toEqual({
      success: false,
      error: "Invalid request",
    });
    await expect(logout(allowedEvent, { platform: "youtube" })).resolves.toEqual({
      success: false,
      error: "Invalid request",
    });

    expect(mocks.ensureKickToken).not.toHaveBeenCalled();
    expect(mocks.kickLogout).not.toHaveBeenCalled();
    expect(mocks.twitchLogout).not.toHaveBeenCalled();
  });

  it("returns only status metadata after Twitch refresh and rejects an untrusted sender", async () => {
    mocks.refreshTwitchToken.mockResolvedValue({ accessToken: "fresh-secret" });
    const refresh = handler(IPC_CHANNELS.AUTH_REFRESH_TWITCH);

    const allowed = await refresh(allowedEvent);
    expect(allowed).toEqual({
      success: true,
      user: null,
      hasToken: false,
      isExpired: false,
    });
    expect(allowed).not.toHaveProperty("token");
    expect(JSON.stringify(allowed)).not.toContain("fresh-secret");

    await expect(refresh(rejectedEvent)).resolves.toEqual({
      success: false,
      error: "Request rejected",
    });
  });

  it("exposes the IRC/Hermes token capability only to the trusted app renderer", async () => {
    mocks.getValidTwitchToken.mockResolvedValue("chat-secret");
    const getChatToken = handler(IPC_CHANNELS.AUTH_GET_VALID_TWITCH_TOKEN);

    await expect(getChatToken(allowedEvent)).resolves.toBe("chat-secret");
    await expect(getChatToken(rejectedEvent)).resolves.toBeNull();
    expect(mocks.getValidTwitchToken).toHaveBeenCalledTimes(1);
  });
});
