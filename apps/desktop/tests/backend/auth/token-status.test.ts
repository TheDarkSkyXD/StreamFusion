import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type TokenStatusResult } from "@/shared/ipc-channels";

// Capture ipcMain.handle registrations so we can invoke the token-status handler
// directly with a synthetic event (controlling senderFrame.url), exactly like
// the proxy-handlers test does.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

// Mock the auth barrel — only `tokenExchangeService.getTokenStatus` is used.
const getTokenStatus = vi.fn();
vi.mock("@/backend/auth", () => ({
  tokenExchangeService: {
    getTokenStatus: (...a: unknown[]) => getTokenStatus(...a),
  },
}));

const hasToken = vi.fn();
const getToken = vi.fn();
vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    hasToken: (...a: unknown[]) => hasToken(...a),
    getToken: (...a: unknown[]) => getToken(...a),
  },
}));

import { ipcMain } from "electron";

import { registerTokenStatusHandlers } from "@/backend/ipc/handlers/token-status-handlers";

type Handler = (event: unknown, args?: unknown) => unknown;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

const ALLOWED_FILE = { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } };
const ALLOWED_DEV = { senderFrame: { url: "http://localhost:5173/index.html" } };
const DISALLOWED_REMOTE = { senderFrame: { url: "https://www.twitch.tv/embed" } };

async function invoke(
  event: unknown,
  platform: "twitch" | "kick"
): Promise<TokenStatusResult> {
  registerTokenStatusHandlers();
  const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
  return (await handler(event, { platform })) as TokenStatusResult;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AUTH_TOKEN_STATUS — validity reporting", () => {
  it("valid token → { connected, valid, login, userId, scopes, expiresAt }", async () => {
    hasToken.mockReturnValue(true);
    getToken.mockReturnValue({ accessToken: "secret-twitch", scope: ["chat:read"] });
    getTokenStatus.mockResolvedValue({
      valid: true,
      login: "streamer",
      userId: "12345",
      scopes: ["chat:read", "chat:edit"],
      expiresAt: 1_900_000_000_000,
    });

    const result = await invoke(ALLOWED_FILE, "twitch");

    expect(result).toEqual({
      platform: "twitch",
      connected: true,
      valid: true,
      login: "streamer",
      userId: "12345",
      scopes: ["chat:read", "chat:edit"],
      expiresAt: 1_900_000_000_000,
    });
    // The stored token was passed to the validator (token stays in main).
    expect(getTokenStatus).toHaveBeenCalledWith("twitch", {
      accessToken: "secret-twitch",
      scope: ["chat:read"],
    });
  });

  it("expired/invalid token → { connected:true, valid:false } and no identity", async () => {
    hasToken.mockReturnValue(true);
    getToken.mockReturnValue({ accessToken: "stale" });
    getTokenStatus.mockResolvedValue({ valid: false });

    const result = await invoke(ALLOWED_FILE, "twitch");

    expect(result.connected).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.login).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it("not-connected (no token) → { connected:false, valid:false } and never validates", async () => {
    hasToken.mockReturnValue(false);

    const result = await invoke(ALLOWED_FILE, "kick");

    expect(result).toEqual({ platform: "kick", connected: false, valid: false });
    expect(getToken).not.toHaveBeenCalled();
    expect(getTokenStatus).not.toHaveBeenCalled();
  });

  it("Kick expiry falls back to the stored token expiresAt", async () => {
    hasToken.mockReturnValue(true);
    getToken.mockReturnValue({ accessToken: "kick-token", expiresAt: 1_777_000_000_000 });
    // Simulate the Kick path: current-user re-fetch succeeded, expiry sourced
    // from the stored token (the API surface returns no expiry).
    getTokenStatus.mockResolvedValue({
      valid: true,
      login: "kickname",
      userId: "676",
      scopes: [],
      expiresAt: 1_777_000_000_000,
    });

    const result = await invoke(ALLOWED_FILE, "kick");

    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBe(1_777_000_000_000);
    expect(result.userId).toBe("676");
  });
});

describe("AUTH_TOKEN_STATUS — sender-origin enforcement", () => {
  it("allows the loopback dev server origin", async () => {
    hasToken.mockReturnValue(false);
    const result = await invoke(ALLOWED_DEV, "twitch");
    expect(result.connected).toBe(false);
    // Reached the handler body (hasToken was consulted).
    expect(hasToken).toHaveBeenCalled();
  });

  it("REJECTS a remote https sender: never reads tokens or validates", async () => {
    hasToken.mockReturnValue(true);
    getToken.mockReturnValue({ accessToken: "secret" });
    getTokenStatus.mockResolvedValue({ valid: true });

    const result = await invoke(DISALLOWED_REMOTE, "twitch");

    expect(result).toEqual({ platform: "twitch", connected: false, valid: false });
    expect(hasToken).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(getTokenStatus).not.toHaveBeenCalled();
  });

  it("REJECTS a missing senderFrame", async () => {
    hasToken.mockReturnValue(true);
    const result = await invoke({ senderFrame: null }, "twitch");
    expect(result.connected).toBe(false);
    expect(hasToken).not.toHaveBeenCalled();
  });
});

describe("AUTH_TOKEN_STATUS — security: no token value crosses IPC", () => {
  it("the returned object has NO accessToken/token/refreshToken/access_token key", async () => {
    hasToken.mockReturnValue(true);
    getToken.mockReturnValue({
      accessToken: "TOP-SECRET-ACCESS",
      refreshToken: "TOP-SECRET-REFRESH",
      scope: ["chat:read"],
    });
    getTokenStatus.mockResolvedValue({
      valid: true,
      login: "streamer",
      userId: "12345",
      scopes: ["chat:read"],
      expiresAt: 1_900_000_000_000,
    });

    const result = await invoke(ALLOWED_FILE, "twitch");

    // Strict shape: exactly these keys, nothing token-bearing.
    expect(Object.keys(result).sort()).toEqual(
      ["connected", "expiresAt", "login", "platform", "scopes", "userId", "valid"].sort()
    );
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("access_token");
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("refreshToken");
    // Belt-and-suspenders: the serialized payload contains no secret value.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("TOP-SECRET-ACCESS");
    expect(serialized).not.toContain("TOP-SECRET-REFRESH");
  });
});
