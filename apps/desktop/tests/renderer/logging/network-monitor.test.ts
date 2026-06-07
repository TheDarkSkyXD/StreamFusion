/**
 * network-monitor.test.ts (renderer)
 *
 * Guards the passive renderer-side online/offline listener. Mirrors the Valo
 * NetworkMonitor: log the INITIAL state at install time, then one line per
 * transition, with offline at warn so it surfaces under default-level filters.
 *
 * The renderer logger is mocked so the test doesn't touch the IPC bridge.
 * The module is reset between cases so the module-level "installed" flag is
 * fresh.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type NetMonModule = typeof import("@/renderer/logging/network-monitor");
type LoggerMock = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

async function freshNetMon(): Promise<{
  mod: NetMonModule;
  logger: LoggerMock;
}> {
  vi.resetModules();
  const mod = await import("@/renderer/logging/network-monitor");
  const { logger } = (await import("@/renderer/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

let uninstallers: Array<() => void> = [];

beforeEach(() => {
  uninstallers = [];
  // Default to online so each test starts from a known baseline.
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  for (const u of uninstallers) {
    try {
      u();
    } catch {
      // best-effort
    }
  }
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

// ---------------------------------------------------------------------------
// Initial state — log "initial: online" or "initial: offline" at install
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — initial state", () => {
  it("logs initial state as 'online' when navigator.onLine is true", async () => {
    setOnline(true);
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor());
    expect(logger.info).toHaveBeenCalledWith("NetworkMonitor", "initial: online");
  });

  it("logs initial state as 'offline' when navigator.onLine is false", async () => {
    setOnline(false);
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor());
    expect(logger.info).toHaveBeenCalledWith("NetworkMonitor", "initial: offline");
  });
});

// ---------------------------------------------------------------------------
// Transitions — online -> info, offline -> warn (warn keeps offline visible
// under default-level filters)
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — transitions", () => {
  it("logs 'online' at info level when the online event fires", async () => {
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor());
    logger.info.mockReset();
    window.dispatchEvent(new Event("online"));
    expect(logger.info).toHaveBeenCalledWith("NetworkMonitor", "online");
  });

  it("logs 'offline' at warn level when the offline event fires", async () => {
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor());
    window.dispatchEvent(new Event("offline"));
    expect(logger.warn).toHaveBeenCalledWith("NetworkMonitor", "offline");
  });
});

// ---------------------------------------------------------------------------
// Uninstall — removes listeners so no further events are logged
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — uninstall", () => {
  it("removes both listeners; no logs fire after uninstall", async () => {
    const { mod, logger } = await freshNetMon();
    const uninstall = mod.installNetworkMonitor();
    logger.info.mockReset();
    logger.warn.mockReset();
    uninstall();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency — second install returns the same uninstall and does not
// stack listeners (we'd otherwise log every transition twice)
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — idempotent install", () => {
  it("second install returns the same uninstall fn", async () => {
    const { mod } = await freshNetMon();
    const u1 = mod.installNetworkMonitor();
    const u2 = mod.installNetworkMonitor();
    uninstallers.push(u1);
    expect(u2).toBe(u1);
  });

  it("does not stack listeners — one transition produces one log", async () => {
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor());
    mod.installNetworkMonitor();
    logger.warn.mockReset();
    window.dispatchEvent(new Event("offline"));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Custom tag override
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — custom tag", () => {
  it("uses the provided tag for both initial state and transitions", async () => {
    const { mod, logger } = await freshNetMon();
    uninstallers.push(mod.installNetworkMonitor({ tag: "Net" }));
    expect(logger.info).toHaveBeenCalledWith("Net", "initial: online");
    window.dispatchEvent(new Event("offline"));
    expect(logger.warn).toHaveBeenCalledWith("Net", "offline");
  });
});

// ---------------------------------------------------------------------------
// Missing window — no-op + no-op uninstall (SSR / test contexts that strip it)
// ---------------------------------------------------------------------------

describe("installNetworkMonitor — missing window guard", () => {
  it("returns a no-op uninstall and does not throw when window is undefined", async () => {
    const realWindow = (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { window?: Window }).window;
    try {
      const { mod, logger } = await freshNetMon();
      const uninstall = mod.installNetworkMonitor();
      expect(typeof uninstall).toBe("function");
      expect(() => uninstall()).not.toThrow();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { window?: Window }).window = realWindow;
    }
  });
});
