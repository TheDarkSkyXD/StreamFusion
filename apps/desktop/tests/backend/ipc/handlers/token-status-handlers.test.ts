import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    hasToken: vi.fn(),
    getToken: vi.fn(),
  },
}));

vi.mock("@/backend/auth", () => ({
  tokenExchangeService: {
    getTokenStatus: vi.fn(),
  },
}));

vi.mock("@/backend/ipc/sender-origin", () => ({
  isAllowedSender: vi.fn(),
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { tokenExchangeService } from "@/backend/auth";
import { registerTokenStatusHandlers } from "@/backend/ipc/handlers/token-status-handlers";
import { isAllowedSender } from "@/backend/ipc/sender-origin";
import { storageService } from "@/backend/services/storage-service";

type Handler = (event: unknown, args: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerTokenStatusHandlers();
});

describe("registerTokenStatusHandlers", () => {
  it("registers AUTH_TOKEN_STATUS channel", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.AUTH_TOKEN_STATUS);
  });
});

describe("AUTH_TOKEN_STATUS", () => {
  it("rejects disallowed sender origin with not-connected result", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({ platform: "kick", connected: false, valid: false });
    expect(storageService.hasToken).not.toHaveBeenCalled();
  });

  it("returns not-connected when no token exists", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(true);
    vi.mocked(storageService.hasToken).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({ platform: "twitch", connected: false, valid: false });
  });

  it("returns connected-but-invalid when hasToken is true but getToken returns null", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(true);
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    vi.mocked(storageService.getToken).mockReturnValue(null);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({ platform: "kick", connected: true, valid: false });
    expect(tokenExchangeService.getTokenStatus).not.toHaveBeenCalled();
  });

  it("returns full token status report when token exists and validates", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(true);
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    const fakeToken = { accessToken: "secret", refreshToken: "also-secret" };
    vi.mocked(storageService.getToken).mockReturnValue(fakeToken as any);

    const report = {
      valid: true,
      login: "testuser",
      userId: "12345",
      scopes: ["chat:read", "chat:edit"],
      expiresAt: "2026-12-01T00:00:00Z",
    };
    vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue(report as any);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({
      platform: "twitch",
      connected: true,
      valid: true,
      login: "testuser",
      userId: "12345",
      scopes: ["chat:read", "chat:edit"],
      expiresAt: "2026-12-01T00:00:00Z",
    });
  });

  it("never leaks token values across IPC — result shape has no accessToken/refreshToken keys", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(true);
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    vi.mocked(storageService.getToken).mockReturnValue({
      accessToken: "SHOULD_NOT_APPEAR",
      refreshToken: "SHOULD_NOT_APPEAR",
    } as any);

    vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue({
      valid: true,
      login: "u",
      userId: "1",
      scopes: [],
      expiresAt: null,
    } as any);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = (await handler({}, { platform: "kick" })) as Record<string, unknown>;

    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("refreshToken");
  });

  it("returns valid=false when getTokenStatus reports invalid", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(true);
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    vi.mocked(storageService.getToken).mockReturnValue({ accessToken: "x" } as any);

    vi.mocked(tokenExchangeService.getTokenStatus).mockResolvedValue({
      valid: false,
      login: undefined,
      userId: undefined,
      scopes: undefined,
      expiresAt: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.AUTH_TOKEN_STATUS);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toMatchObject({ connected: true, valid: false });
  });
});
