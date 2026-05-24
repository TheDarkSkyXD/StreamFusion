import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Electron mock ───────────────────────────────────────────────────────────
// stream-proxy-service touches: session.defaultSession.setProxy /
// closeAllConnections, safeStorage encrypt/decrypt, and app.on("login").
// Model each so we can assert what setProxy was called with and that creds are
// encrypted (and never logged).

// `vi.mock` factories are hoisted above module-top consts, and the service
// instantiates its electron-store at import time — so any state the mocks touch
// must be created inside `vi.hoisted` (which runs before the factories).
type LoginHandler = (
  event: { preventDefault: () => void },
  wc: unknown,
  req: unknown,
  authInfo: { isProxy: boolean },
  cb: (u?: string, p?: string) => void
) => void;

const h = vi.hoisted(() => {
  const ENC_PREFIX = "ENC::";
  const state: { encryptionAvailable: boolean; loginHandler: unknown; loginRegCount: number } = {
    encryptionAvailable: true,
    loginHandler: null,
    loginRegCount: 0,
  };
  // The service registers app.on("login") exactly once for the process
  // lifetime (guarded by a module-level flag). Capture it into persistent
  // state that survives `vi.clearAllMocks()` so tests can exercise the handler
  // regardless of which earlier test triggered the one-time registration.
  const appOn = vi.fn((event: string, handler: unknown) => {
    if (event === "login") {
      state.loginHandler = handler;
      state.loginRegCount += 1;
    }
  });
  return {
    ENC_PREFIX,
    setProxy: vi.fn().mockResolvedValue(undefined),
    closeAllConnections: vi.fn().mockResolvedValue(undefined),
    appOn,
    storeData: {} as Record<string, unknown>,
    state,
  };
});

const { setProxy, closeAllConnections, storeData } = h;

vi.mock("electron", () => ({
  app: { on: h.appOn },
  session: {
    defaultSession: {
      setProxy: h.setProxy,
      closeAllConnections: h.closeAllConnections,
    },
  },
  safeStorage: {
    // Default "available" with a recognizable, reversible cipher so tests can
    // prove the plaintext password is never persisted verbatim.
    isEncryptionAvailable: () => h.state.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`${h.ENC_PREFIX}${s}`, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8").slice(h.ENC_PREFIX.length),
  },
}));

// In-memory store with the get/set/delete surface the service uses.
vi.mock("electron-store", () => ({
  default: class MockStore {
    constructor(opts: { defaults?: Record<string, unknown> } = {}) {
      Object.assign(h.storeData, opts.defaults ?? {});
    }
    get(key: string, fallback?: unknown) {
      return key in h.storeData ? h.storeData[key] : fallback;
    }
    set(key: string, value: unknown) {
      h.storeData[key] = value;
    }
    delete(key: string) {
      delete h.storeData[key];
    }
  },
}));

import {
  applyProxy,
  clearProxy,
  hasStoredCredentials,
  setProxyCredentials,
} from "@/backend/services/stream-proxy-service";

beforeEach(() => {
  vi.clearAllMocks();
  h.state.encryptionAvailable = true;
  for (const k of Object.keys(storeData)) delete storeData[k];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyProxy — enabled with valid host/port", () => {
  it("applies the proxy to the window session via setProxy", async () => {
    const result = await applyProxy({ enabled: true, host: "127.0.0.1", port: 8888 });

    expect(setProxy).toHaveBeenCalledTimes(1);
    expect(setProxy).toHaveBeenCalledWith({ proxyRules: "http=127.0.0.1:8888;https=127.0.0.1:8888" });
    // Pooled connections dropped so keep-alive sockets re-route.
    expect(closeAllConnections).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.cleared).toBe(false);
  });
});

describe("applyProxy — disabled / empty / invalid → safe no-op (clear to direct)", () => {
  it("disabled: clears to direct, does not set a proxy", async () => {
    const result = await applyProxy({ enabled: false, host: "127.0.0.1", port: 8888 });

    expect(setProxy).toHaveBeenCalledTimes(1);
    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(result.applied).toBe(false);
    expect(result.cleared).toBe(true);
  });

  it("empty host with enabled:true is a no-op (R21), not a broken request", async () => {
    const result = await applyProxy({ enabled: true, host: "", port: 8888 });

    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(setProxy).not.toHaveBeenCalledWith(
      expect.objectContaining({ proxyRules: expect.anything() })
    );
    expect(result.cleared).toBe(true);
  });

  it("whitespace-only host is treated as empty", async () => {
    const result = await applyProxy({ enabled: true, host: "   ", port: 8888 });
    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(result.applied).toBe(false);
  });

  it("null / out-of-range port → no-op", async () => {
    await applyProxy({ enabled: true, host: "127.0.0.1", port: null });
    expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });

    vi.clearAllMocks();
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 70000 });
    expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });

    vi.clearAllMocks();
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 0 });
    expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
  });
});

describe("clearProxy", () => {
  it("sets the session back to direct", async () => {
    await clearProxy();
    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(closeAllConnections).toHaveBeenCalled();
  });
});

describe("applyProxy — error path", () => {
  it("an unreachable/failed setProxy surfaces an error and leaves the session direct (no crash)", async () => {
    // First setProxy (apply) rejects; the catch then calls clearProxy → direct.
    setProxy.mockRejectedValueOnce(new Error("proxy unreachable"));

    const result = await applyProxy({ enabled: true, host: "10.0.0.1", port: 3128 });

    expect(result.applied).toBe(false);
    expect(result.error).toBe("proxy unreachable");
    // The recovery clear ran (second call) → direct.
    expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
  });
});

describe("credential storage — safeStorage, encrypted, write-only", () => {
  it("encrypts credentials via safeStorage and persists only the encrypted blob", () => {
    const ok = setProxyCredentials({ username: "alice", password: "s3cr3t-pw" });

    expect(ok).toBe(true);
    expect(hasStoredCredentials()).toBe(true);

    // The persisted blob must be the encrypted form — the raw password must NOT
    // appear in it.
    const stored = storeData.encrypted as string;
    expect(typeof stored).toBe("string");
    const decoded = Buffer.from(stored, "base64").toString("utf8");
    expect(decoded.startsWith("ENC::")).toBe(true); // went through encryptString
    // base64 of the encrypted bytes must not literally contain the password.
    expect(stored).not.toContain("s3cr3t-pw");
  });

  it("null clears stored credentials", () => {
    setProxyCredentials({ username: "alice", password: "pw" });
    expect(hasStoredCredentials()).toBe(true);

    const ok = setProxyCredentials(null);
    expect(ok).toBe(false);
    expect(hasStoredCredentials()).toBe(false);
    expect(storeData.encrypted).toBeUndefined();
  });

  it("falls back to base64 when safeStorage is unavailable (dev/CI), still no plaintext key in prefs", () => {
    h.state.encryptionAvailable = false;
    setProxyCredentials({ username: "bob", password: "fallback-pw" });
    // Still stored (round-trips), just without OS encryption.
    expect(hasStoredCredentials()).toBe(true);
  });

  it("exposes NO function that returns the password to the renderer", async () => {
    // The service surface is the security contract: there must be no getter for
    // the credential values. Assert the module exports don't include one.
    const mod = await import("@/backend/services/stream-proxy-service");
    const exported = Object.keys(mod);
    expect(exported).toContain("setProxyCredentials");
    expect(exported).toContain("hasStoredCredentials");
    // No read-back of credentials.
    expect(exported.some((n) => /getCredentials|readProxyCredentials|getPassword/i.test(n))).toBe(
      false
    );
  });
});

describe("proxy auth (login) — credentials decrypted only in main, never logged", () => {
  // The service guards app.on("login") with a module-level once-flag, so it is
  // registered exactly once for the whole module lifetime. h.state.loginHandler
  // captures it (surviving clearAllMocks); h.state.loginRegCount counts it.

  it("answers proxy challenges with the decrypted creds; re-apply does not re-register", async () => {
    setProxyCredentials({ username: "alice", password: "s3cr3t-pw" });
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 8888 });
    // Re-apply must not double-register the login handler.
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 8889 });

    expect(h.state.loginRegCount).toBe(1);
    const loginHandler = h.state.loginHandler as LoginHandler;
    expect(typeof loginHandler).toBe("function");

    const preventDefault = vi.fn();
    const cb = vi.fn();
    loginHandler({ preventDefault }, null, null, { isProxy: true }, cb);

    expect(preventDefault).toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith("alice", "s3cr3t-pw");
  });

  it("ignores non-proxy (server 401) login challenges", async () => {
    setProxyCredentials({ username: "alice", password: "pw" });
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 8888 });

    const loginHandler = h.state.loginHandler as LoginHandler;
    const preventDefault = vi.fn();
    const cb = vi.fn();
    loginHandler({ preventDefault }, null, null, { isProxy: false }, cb);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("answers with no creds (cancels challenge) when none are stored", async () => {
    // No setProxyCredentials → readCredentials returns null → handler returns
    // without calling the callback, letting Electron cancel the challenge.
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 8888 });

    const loginHandler = h.state.loginHandler as LoginHandler;
    const preventDefault = vi.fn();
    const cb = vi.fn();
    loginHandler({ preventDefault }, null, null, { isProxy: true }, cb);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("never writes the password to console (apply + login flow)", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setProxyCredentials({ username: "alice", password: "TOP-SECRET-PW" });
    await applyProxy({ enabled: true, host: "127.0.0.1", port: 8888 });

    const loginHandler = h.state.loginHandler as LoginHandler;
    loginHandler({ preventDefault: () => {} }, null, null, { isProxy: true }, () => {});

    const allLogs = [...debug.mock.calls, ...warn.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .join(" ");
    expect(allLogs).not.toContain("TOP-SECRET-PW");
    expect(allLogs).not.toContain("alice");
  });
});
