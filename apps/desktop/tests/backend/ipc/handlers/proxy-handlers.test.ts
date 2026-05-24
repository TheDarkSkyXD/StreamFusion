import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type ProxyApplyResult } from "@/shared/ipc-channels";

// Capture ipcMain.handle registrations so we can invoke each proxy handler
// directly with a synthetic event (controlling senderFrame.url).
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

const applyProxy = vi.fn();
const setProxyCredentials = vi.fn();
const hasStoredCredentials = vi.fn();
vi.mock("@/backend/services/stream-proxy-service", () => ({
  applyProxy: (...a: unknown[]) => applyProxy(...a),
  setProxyCredentials: (...a: unknown[]) => setProxyCredentials(...a),
  hasStoredCredentials: (...a: unknown[]) => hasStoredCredentials(...a),
}));

const getPreferences = vi.fn();
vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getPreferences: (...a: unknown[]) => getPreferences(...a),
  },
}));

import { ipcMain } from "electron";

import {
  applyPersistedProxyOnStart,
  registerProxyHandlers,
} from "@/backend/ipc/handlers/proxy-handlers";

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
const DISALLOWED_DATA = { senderFrame: { url: "data:text/html,<script>x</script>" } };

beforeEach(() => {
  vi.clearAllMocks();
  applyProxy.mockResolvedValue({
    applied: true,
    cleared: false,
    hasCredentials: false,
  } satisfies ProxyApplyResult);
  hasStoredCredentials.mockReturnValue(false);
  setProxyCredentials.mockReturnValue(true);
});

describe("PROXY_APPLY — sender-origin enforcement", () => {
  it("allows the app's own file:// renderer and forwards to applyProxy", async () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_APPLY);

    const config = { enabled: true, host: "127.0.0.1", port: 8888 };
    const result = await handler(ALLOWED_FILE, { config });

    expect(applyProxy).toHaveBeenCalledWith(config);
    expect((result as ProxyApplyResult).applied).toBe(true);
  });

  it("allows the loopback dev server origin", async () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_APPLY);
    await handler(ALLOWED_DEV, { config: { enabled: false, host: "", port: null } });
    expect(applyProxy).toHaveBeenCalledTimes(1);
  });

  it("REJECTS a remote https sender and never calls applyProxy", async () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_APPLY);

    const result = (await handler(DISALLOWED_REMOTE, {
      config: { enabled: true, host: "evil.example", port: 9999 },
    })) as ProxyApplyResult;

    expect(applyProxy).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/not the application renderer/i);
  });

  it("REJECTS a data: URL sender", async () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_APPLY);
    await handler(DISALLOWED_DATA, { config: { enabled: true, host: "x", port: 1 } });
    expect(applyProxy).not.toHaveBeenCalled();
  });

  it("REJECTS a missing senderFrame", async () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_APPLY);
    await handler({ senderFrame: null }, { config: { enabled: true, host: "x", port: 1 } });
    expect(applyProxy).not.toHaveBeenCalled();
  });
});

describe("PROXY_SET_CREDENTIALS — sender-origin enforcement + write-only", () => {
  it("stores credentials when called by the app renderer", () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_SET_CREDENTIALS);

    const result = handler(ALLOWED_FILE, {
      credentials: { username: "alice", password: "pw" },
    }) as { hasCredentials: boolean };

    expect(setProxyCredentials).toHaveBeenCalledWith({ username: "alice", password: "pw" });
    expect(result.hasCredentials).toBe(true);
  });

  it("does NOT mutate stored credentials on a disallowed sender", () => {
    hasStoredCredentials.mockReturnValue(false);
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_SET_CREDENTIALS);

    const result = handler(DISALLOWED_REMOTE, {
      credentials: { username: "attacker", password: "x" },
    }) as { hasCredentials: boolean };

    expect(setProxyCredentials).not.toHaveBeenCalled();
    expect(result.hasCredentials).toBe(false);
  });

  it("never returns the password — only an advisory hasCredentials boolean", () => {
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_SET_CREDENTIALS);
    const result = handler(ALLOWED_FILE, {
      credentials: { username: "alice", password: "super-secret" },
    }) as Record<string, unknown>;

    expect(Object.keys(result)).toEqual(["hasCredentials"]);
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("alice");
  });
});

describe("PROXY_HAS_CREDENTIALS", () => {
  it("returns the stored flag for the app renderer", () => {
    hasStoredCredentials.mockReturnValue(true);
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_HAS_CREDENTIALS);
    expect((handler(ALLOWED_FILE) as { hasCredentials: boolean }).hasCredentials).toBe(true);
  });

  it("returns false for a disallowed sender", () => {
    hasStoredCredentials.mockReturnValue(true);
    registerProxyHandlers();
    const handler = getHandler(IPC_CHANNELS.PROXY_HAS_CREDENTIALS);
    expect((handler(DISALLOWED_REMOTE) as { hasCredentials: boolean }).hasCredentials).toBe(false);
  });
});

describe("applyPersistedProxyOnStart", () => {
  it("reads the stored proxy prefs and applies host/port/enabled (no credentials in the call)", () => {
    getPreferences.mockReturnValue({
      proxy: { enabled: true, host: "127.0.0.1", port: 8080, hasCredentials: true },
    });
    applyPersistedProxyOnStart();
    expect(applyProxy).toHaveBeenCalledWith({ enabled: true, host: "127.0.0.1", port: 8080 });
  });

  it("disabled persisted proxy still calls applyProxy (which no-ops to direct)", () => {
    getPreferences.mockReturnValue({
      proxy: { enabled: false, host: "", port: null, hasCredentials: false },
    });
    applyPersistedProxyOnStart();
    expect(applyProxy).toHaveBeenCalledWith({ enabled: false, host: "", port: null });
  });
});
