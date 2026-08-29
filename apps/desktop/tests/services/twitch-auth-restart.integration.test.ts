import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type AuthToken, TWITCH_APP_SCOPES, type TwitchUser } from "@/shared/auth-types";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

const harness = {
  storageDirectory: "",
  encryptionAvailable: false,
};

type IpcHandler = (event: unknown, payload?: unknown) => unknown;

const registeredIpcHandlers = new Map<string, IpcHandler>();

const safeStorageBoundary = {
  encryptString: vi.fn((value: string) =>
    Buffer.from(`fake-safe-storage:${Buffer.from(value).toString("base64")}`, "utf8")
  ),
  decryptString: vi.fn((value: Buffer) => {
    const encoded = value.toString("utf8");
    const prefix = "fake-safe-storage:";
    if (!encoded.startsWith(prefix)) {
      throw new Error("Fake safeStorage rejected non-encrypted bytes");
    }
    return Buffer.from(encoded.slice(prefix.length), "base64").toString("utf8");
  }),
};

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function removePersistedTokenEncoding(storePath: string): void {
  const stored = JSON.parse(readFileSync(storePath, "utf8")) as {
    authTokens?: { twitch?: { encrypted?: unknown; encoding?: unknown } };
  };
  const envelope = stored.authTokens?.twitch;
  if (typeof envelope?.encrypted !== "string") {
    throw new Error("Expected the fake store to contain a Twitch token envelope");
  }
  delete envelope.encoding;
  writeFileSync(storePath, JSON.stringify(stored), "utf8");
}

function readPersistedTwitchTokenEnvelope(storePath: string): {
  encrypted: string;
  encoding?: string;
} {
  const stored = JSON.parse(readFileSync(storePath, "utf8")) as {
    authTokens?: { twitch?: { encrypted?: unknown; encoding?: unknown } };
  };
  const envelope = stored.authTokens?.twitch;
  if (typeof envelope?.encrypted !== "string") {
    throw new Error("Expected the fake store to contain a Twitch token envelope");
  }
  return {
    encrypted: envelope.encrypted,
    ...(typeof envelope.encoding === "string" ? { encoding: envelope.encoding } : {}),
  };
}

const fakeToken: AuthToken = {
  accessToken: "fake-current-device-access-token",
  refreshToken: "fake-current-device-refresh-token",
  expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
  scope: [...TWITCH_APP_SCOPES],
  authFlow: "device-code",
};

const fakeUser: TwitchUser = {
  id: "fake-twitch-user-id",
  login: "fake_restart_user",
  displayName: "Fake Restart User",
  profileImageUrl: "https://example.test/fake-avatar.png",
  email: "fake-restart-user@example.test",
  createdAt: "2026-01-01T00:00:00.000Z",
  broadcasterType: "",
};

async function loadBackendProcess(encryptionAvailable: boolean) {
  harness.encryptionAvailable = encryptionAvailable;
  vi.resetModules();
  const { storageService } = await import("@/backend/services/storage-service");
  storageService.initialize();
  return storageService;
}

async function loadAuthenticatedBackendProcess(encryptionAvailable: boolean) {
  const storageService = await loadBackendProcess(encryptionAvailable);
  const { twitchAuthService } = await import("@/backend/auth/twitch-auth");
  return { storageService, twitchAuthService };
}

beforeAll(() => {
  vi.doMock("electron", () => ({
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        registeredIpcHandlers.set(channel, handler);
      }),
    },
    safeStorage: {
      isEncryptionAvailable: () => harness.encryptionAvailable,
      encryptString: safeStorageBoundary.encryptString,
      decryptString: safeStorageBoundary.decryptString,
    },
  }));

  vi.doMock("electron-store", () => ({
    default: class JsonBackedStore {
      private data: Record<string, unknown>;
      readonly path: string;

      constructor(options: { defaults?: Record<string, unknown>; name?: string } = {}) {
        this.path = join(harness.storageDirectory, `${options.name ?? "store"}.json`);
        this.data = existsSync(this.path)
          ? (JSON.parse(readFileSync(this.path, "utf8")) as Record<string, unknown>)
          : cloneJson(options.defaults ?? {});
        this.persist();
      }

      get(key: string): unknown {
        const value = this.data[key];
        return value === undefined ? undefined : cloneJson(value);
      }

      get store(): Record<string, unknown> {
        return cloneJson(this.data);
      }

      set store(value: Record<string, unknown>) {
        this.data = cloneJson(value);
        this.persist();
      }

      set(key: string, value: unknown): void {
        this.data[key] = cloneJson(value);
        this.persist();
      }

      delete(key: string): void {
        delete this.data[key];
        this.persist();
      }

      clear(): void {
        this.data = {};
        this.persist();
      }

      private persist(): void {
        writeFileSync(this.path, JSON.stringify(this.data), "utf8");
      }
    },
  }));

  vi.doMock("@/lib/cross-logger", () => ({ logger }));
  vi.doMock("@/backend/logging/logger", () => ({ logger }));
  vi.doMock("@/backend/auth/oauth-config", () => ({
    WORKER_BASE_URL: "https://worker.example.test",
    getOAuthConfig: () => ({
      platform: "twitch",
      clientId: "fake-twitch-client-id",
      clientSecret: "",
      authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
      tokenEndpoint: "https://id.twitch.tv/oauth2/token",
      revokeEndpoint: "https://id.twitch.tv/oauth2/revoke",
      scopes: [...TWITCH_APP_SCOPES],
      usesPkce: true,
    }),
  }));
  vi.doMock("@/backend/services/database-service", () => ({
    dbService: {
      clearFollows: vi.fn(),
      clearKeyValue: vi.fn(),
      migrateKeyValues: vi.fn(),
    },
  }));
});

beforeEach(() => {
  harness.storageDirectory = mkdtempSync(join(tmpdir(), "streamfusion-auth-restart-"));
  harness.encryptionAvailable = false;
  registeredIpcHandlers.clear();
  safeStorageBoundary.encryptString.mockClear();
  safeStorageBoundary.decryptString.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  Reflect.deleteProperty(window, "electronAPI");
  rmSync(harness.storageDirectory, { recursive: true, force: true });
});

afterAll(() => {
  vi.doUnmock("electron");
  vi.doUnmock("electron-store");
  vi.doUnmock("@/lib/cross-logger");
  vi.doUnmock("@/backend/logging/logger");
  vi.doUnmock("@/backend/auth/oauth-config");
  vi.doUnmock("@/backend/services/database-service");
});

// Guards: a legacy unmarked device-code Twitch session survives a backend restart and is immediately migrated to encryption.
// Guards: auth-handler registration must not delete a recoverable unmarked Twitch session during cold start.
// Guards: a marked safeStorage session remains recoverable when one startup cannot decrypt it, while renderer startup neither refreshes nor clears it.
// Guards: the public Twitch chat token seam validates and returns a restored session after a fresh backend start.
// Guards: transient Twitch validation and refresh failures never erase the persisted session.
// Guards: an expired restored session refreshes through Twitch auth and the rotated token survives another backend restart.
describe("Twitch auth restart persistence", () => {
  it("preserves a recoverable unmarked Twitch session when cold-start handlers register", async () => {
    const legacyToken: AuthToken = {
      accessToken: fakeToken.accessToken,
      refreshToken: fakeToken.refreshToken,
      expiresAt: fakeToken.expiresAt,
      scope: fakeToken.scope,
    };
    const processAStorage = await loadBackendProcess(false);
    processAStorage.saveToken("twitch", legacyToken);
    processAStorage.saveTwitchUser(fakeUser);

    const processBStorage = await loadBackendProcess(true);
    const { registerAuthHandlers } = await import("@/backend/ipc/handlers/auth-handlers");
    registerAuthHandlers({
      isDestroyed: () => false,
      on: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never);

    expect(processBStorage.getToken("twitch")).toEqual(legacyToken);
    expect(processBStorage.getTwitchUser()).toEqual(fakeUser);
  });

  it("retains an unreadable safeStorage session without treating it as refreshable", async () => {
    vi.useFakeTimers();
    const processAStorage = await loadBackendProcess(true);
    processAStorage.saveToken("twitch", fakeToken);
    processAStorage.saveTwitchUser(fakeUser);
    const storePath = processAStorage.getStorePath();
    const processAEnvelope = readPersistedTwitchTokenEnvelope(storePath);

    const processBStorage = await loadBackendProcess(false);
    const { registerAuthHandlers } = await import("@/backend/ipc/handlers/auth-handlers");
    registerAuthHandlers({
      isDestroyed: () => false,
      on: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as never);

    const getStatusHandler = registeredIpcHandlers.get(IPC_CHANNELS.AUTH_GET_STATUS);
    if (!getStatusHandler) throw new Error("AUTH_GET_STATUS handler was not registered");
    const getStatus = vi.fn(async () =>
      getStatusHandler({ senderFrame: { url: "file:///renderer/index.html" } })
    );
    const refreshTwitchToken = vi.fn(async () => ({
      success: false,
      error: "safeStorage unavailable",
    }));
    const clearToken = vi.fn(async () => {});
    const clearTwitchUser = vi.fn(async () => {});
    const preferences = {};
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      writable: true,
      value: {
        auth: {
          getStatus,
          refreshTwitchToken,
          refreshKickToken: vi.fn(async () => ({ success: false })),
          clearToken,
          clearTwitchUser,
          clearKickUser: vi.fn(async () => {}),
          onKickSessionExpired: vi.fn(() => () => {}),
          onTwitchAuthLost: vi.fn(() => () => {}),
          onFollowsSynced: vi.fn(() => () => {}),
          syncFollows: vi.fn(async () => ({ success: true })),
        },
        follows: { getAll: vi.fn(async () => []) },
        preferences: { get: vi.fn(async () => preferences) },
      },
    });

    const { useAuthStore } = await import("@/store/auth-store");
    await useAuthStore.getState().initializeAuth();
    const rendererStatus = await getStatus();
    const processBEnvelope = readPersistedTwitchTokenEnvelope(storePath);
    const serializedLogs = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.error.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);

    expect(processAEnvelope.encoding).toBe("safeStorage");
    expect(processBStorage.hasToken("twitch")).toBe(true);
    expect(processBStorage.getTwitchUser()).toEqual(fakeUser);
    expect(rendererStatus).toMatchObject({
      twitch: {
        connected: false,
        user: fakeUser,
        hasToken: false,
        isExpired: true,
      },
      isGuest: false,
    });
    expect(refreshTwitchToken).not.toHaveBeenCalled();
    expect(clearToken).not.toHaveBeenCalled();
    expect(clearTwitchUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      twitchUser: fakeUser,
      twitchConnected: false,
      twitchReconnectRequired: true,
      initialized: true,
    });
    expect(processBEnvelope).toEqual(processAEnvelope);
    expect(JSON.stringify(rendererStatus)).not.toContain(fakeToken.accessToken);
    expect(JSON.stringify(rendererStatus)).not.toContain(fakeToken.refreshToken);
    expect(serializedLogs).not.toContain(fakeToken.accessToken);
    expect(serializedLogs).not.toContain(fakeToken.refreshToken);
    expect(JSON.stringify(preferences)).not.toContain(fakeToken.accessToken);
    expect(JSON.stringify(preferences)).not.toContain(fakeToken.refreshToken);

    const processCStorage = await loadBackendProcess(true);
    expect(processCStorage.getToken("twitch")).toEqual(fakeToken);
    expect(processCStorage.getTwitchUser()).toEqual(fakeUser);
  });

  it("restores a legacy fallback-written token and user when safeStorage becomes available", async () => {
    const processAStorage = await loadBackendProcess(false);
    processAStorage.saveToken("twitch", fakeToken);
    processAStorage.saveTwitchUser(fakeUser);
    removePersistedTokenEncoding(processAStorage.getStorePath());

    const processBStorage = await loadBackendProcess(true);

    expect(processBStorage.getToken("twitch")).toEqual(fakeToken);
    expect(processBStorage.getTwitchUser()).toEqual(fakeUser);
    expect(safeStorageBoundary.decryptString).toHaveBeenCalledOnce();
    expect(safeStorageBoundary.encryptString).toHaveBeenCalledOnce();

    const processCStorage = await loadBackendProcess(false);
    expect(processCStorage.getToken("twitch")).toBeNull();

    const processDStorage = await loadBackendProcess(true);
    expect(processDStorage.getToken("twitch")).toEqual(fakeToken);
  });

  it("returns the restored token through the guarded Twitch auth seam", async () => {
    const processAStorage = await loadBackendProcess(false);
    processAStorage.saveToken("twitch", fakeToken);
    processAStorage.saveTwitchUser(fakeUser);

    const validateRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://id.twitch.tv/oauth2/validate");
      expect(init?.headers).toEqual({ Authorization: `OAuth ${fakeToken.accessToken}` });
      return { ok: true, status: 200 } as Response;
    });
    vi.stubGlobal("fetch", validateRequest);

    const processB = await loadAuthenticatedBackendProcess(true);

    await expect(processB.twitchAuthService.getValidAccessToken()).resolves.toBe(
      fakeToken.accessToken
    );
    expect(validateRequest).toHaveBeenCalledOnce();
  });

  it("preserves the restored session when validation and refresh are transiently unavailable", async () => {
    vi.useFakeTimers();
    const processAStorage = await loadBackendProcess(false);
    processAStorage.saveToken("twitch", fakeToken);
    processAStorage.saveTwitchUser(fakeUser);

    const unavailableRequest = vi.fn(async () => {
      throw new TypeError("synthetic network unavailable");
    });
    vi.stubGlobal("fetch", unavailableRequest);

    const processB = await loadAuthenticatedBackendProcess(true);
    await expect(processB.twitchAuthService.getValidAccessToken()).resolves.toBeNull();
    processB.twitchAuthService.cancelProactiveRefresh();
    expect(unavailableRequest).toHaveBeenCalledTimes(2);
    expect(processB.storageService.getToken("twitch")).toEqual(fakeToken);
    expect(processB.storageService.getTwitchUser()).toEqual(fakeUser);

    const processCStorage = await loadBackendProcess(true);
    expect(processCStorage.getToken("twitch")).toEqual(fakeToken);
    expect(processCStorage.getTwitchUser()).toEqual(fakeUser);
  });

  it("refreshes an expired restored token and persists the rotation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
    const expiredToken: AuthToken = {
      ...fakeToken,
      accessToken: "fake-expired-device-access-token",
      refreshToken: "fake-expired-device-refresh-token",
      expiresAt: Date.now() - 1,
    };
    const rotatedToken: AuthToken = {
      accessToken: "fake-rotated-device-access-token",
      refreshToken: "fake-rotated-device-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      scope: [...TWITCH_APP_SCOPES],
      authFlow: "device-code",
    };
    const processAStorage = await loadBackendProcess(false);
    processAStorage.saveToken("twitch", expiredToken);
    processAStorage.saveTwitchUser(fakeUser);

    const refreshRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://id.twitch.tv/oauth2/token");
      expect(init?.method).toBe("POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: rotatedToken.accessToken,
          refresh_token: rotatedToken.refreshToken,
          expires_in: 60 * 60,
          scope: rotatedToken.scope,
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", refreshRequest);

    const processB = await loadAuthenticatedBackendProcess(true);
    await expect(processB.twitchAuthService.getValidAccessToken()).resolves.toBe(
      rotatedToken.accessToken
    );
    processB.twitchAuthService.cancelProactiveRefresh();
    expect(refreshRequest).toHaveBeenCalledOnce();

    const processCStorage = await loadBackendProcess(true);
    expect(processCStorage.getToken("twitch")).toEqual(rotatedToken);
  });
});
