import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

// ── Mocks ────────────────────────────────────────────────────────────────────
// update-service instantiates its electron-store at import time and reads
// `app.isPackaged` inside the scheduler. Both must be backed by `vi.hoisted`
// state so the mock factories (hoisted above module-top consts) can reach them,
// and so each test can flip `isPackaged` / reset the store before a fresh import.

const h = vi.hoisted(() => {
  const state: { isPackaged: boolean; store: Record<string, unknown> } = {
    isPackaged: true,
    store: {},
  };
  return {
    state,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    autoUpdaterOn: vi.fn(),
    setFeedURL: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    // Read lazily via a getter so per-test flips of h.state.isPackaged take
    // effect (the service reads app.isPackaged at schedule time, not import).
    get isPackaged() {
      return h.state.isPackaged;
    },
  },
}));

// electron-updater autoUpdater — capture the manual/auto check calls and the
// settable flags. `on` is a no-op recorder (the service wires several events).
vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on: h.autoUpdaterOn,
    checkForUpdates: h.checkForUpdates,
    downloadUpdate: h.downloadUpdate,
    quitAndInstall: h.quitAndInstall,
    setFeedURL: h.setFeedURL,
  },
}));

// In-memory store mirroring the get/set surface the service uses. Backed by the
// hoisted state so a fresh module import (after resetModules) re-reads it.
vi.mock("electron-store", () => ({
  default: class MockStore {
    constructor(opts: { defaults?: Record<string, unknown> } = {}) {
      for (const [k, v] of Object.entries(opts.defaults ?? {})) {
        if (!(k in h.state.store)) h.state.store[k] = v;
      }
    }
    get(key: string, fallback?: unknown) {
      return key in h.state.store ? h.state.store[key] : fallback;
    }
    set(key: string, value: unknown) {
      h.state.store[key] = value;
    }
  },
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const fakeWindow = {
  send: vi.fn(() => true),
} as unknown as MainRendererPort;

/**
 * Seed the persisted store, flip `isPackaged`, then import a fresh copy of the
 * service so its module-level `currentState` reflects the seeded settings.
 */
async function loadService(opts: { isPackaged?: boolean; store?: Record<string, unknown> }) {
  h.state.isPackaged = opts.isPackaged ?? true;
  h.state.store = { ...(opts.store ?? {}) };
  vi.resetModules();
  return import("@backend/features/settings/adapters/electron/update-service");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Anchor the clock well past 0 so an initial lastCheckAt:0 always reads as
  // "due" on the first tick.
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Guards: every packaged launch checks once, regardless of saved interval settings.
// Guards: extra checks honor the selected interval without overlapping a running check.
describe("update-service launch and periodic checks", () => {
  it("does not repeat the launch check when initialized twice", async () => {
    const svc = await loadService({ isPackaged: true, store: { autoCheckEnabled: false } });
    svc.initUpdateService(fakeWindow);
    const listenerCount = h.autoUpdaterOn.mock.calls.length;

    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(h.autoUpdaterOn).toHaveBeenCalledTimes(listenerCount);
  });

  it("checks at startup and uses the saved interval for additional checks", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(23 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(5);
  });

  it("retries a failed launch check on the next interval", async () => {
    h.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("auto-check OFF still checks at launch but schedules nothing else", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7 * DAY);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("app.isPackaged false: no auto-check even when enabled", async () => {
    const svc = await loadService({
      isPackaged: false,
      store: { autoCheckEnabled: true, checkFrequency: "hourly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7 * DAY);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("frequency changes apply to additional checks", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "weekly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    svc.setAutoCheck({ frequency: "hourly" });
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("enabling extra checks keeps the one launch check", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    const state = svc.setAutoCheck({ enabled: true });
    expect(state.autoCheckEnabled).toBe(true);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("disabling via setAutoCheck stops further scheduled checks", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "hourly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    svc.setAutoCheck({ enabled: false });
    vi.advanceTimersByTime(7 * DAY);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("effectiveIntervalMs never returns below the 1-hour floor (clamp + unknown fallback)", async () => {
    const svc = await loadService({ isPackaged: true, store: {} });

    // Real presets: hourly sits exactly at the floor; daily/weekly above it.
    expect(svc.effectiveIntervalMs("hourly")).toBe(HOUR);
    expect(svc.effectiveIntervalMs("daily")).toBe(DAY);
    expect(svc.effectiveIntervalMs("weekly")).toBe(7 * DAY);

    // A tampered/unknown value can't yield a sub-hour interval (no spin loop):
    // it falls back to the daily default, which is comfortably above the floor.
    const bogus = svc.effectiveIntervalMs("every-minute" as never);
    expect(bogus).toBeGreaterThanOrEqual(HOUR);
    expect(bogus).toBe(7 * DAY);
  });

  it("hourly frequency adds a check after one hour", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "hourly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("checks at launch despite a recent persisted check", async () => {
    const recent = new Date("2026-01-01T00:00:00.000Z").getTime() - HOUR;
    const svc = await loadService({
      isPackaged: true,
      store: {
        autoCheckEnabled: true,
        checkFrequency: "daily",
        lastCheckAt: recent,
      },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

// Guards: manual checks share an in-flight launch check and preferences stay persisted.
describe("update-service manual check and settings", () => {
  it("coalesces a manual check with the launch check", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    await svc.checkForUpdates();
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("getUpdateSettings reports the persisted auto-check fields", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { allowPrerelease: true, autoCheckEnabled: true, checkFrequency: "weekly" },
    });
    svc.initUpdateService(fakeWindow);

    expect(svc.getUpdateSettings()).toEqual({
      allowPrerelease: true,
      autoCheckEnabled: true,
      checkFrequency: "weekly",
      updateCheckUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/latest/download",
    });
  });

  it("setAutoCheck persists both fields to the store", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    svc.setAutoCheck({ enabled: true, frequency: "weekly" });

    expect(h.state.store.autoCheckEnabled).toBe(true);
    expect(h.state.store.checkFrequency).toBe("weekly");
  });

  it("setAllowPrerelease keeps working and does not disturb auto-check", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { allowPrerelease: false, autoCheckEnabled: true, checkFrequency: "daily" },
    });
    svc.initUpdateService(fakeWindow);

    const state = svc.setAllowPrerelease(true);
    expect(state.allowPrerelease).toBe(true);
    // The store recorded it and the auto-check fields are untouched.
    expect(h.state.store.allowPrerelease).toBe(true);
    expect(h.state.store.autoCheckEnabled).toBe(true);
    expect(state.autoCheckEnabled).toBe(true);
  });
});
