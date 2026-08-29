import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
} as unknown as import("electron").BrowserWindow;

/**
 * Seed the persisted store, flip `isPackaged`, then import a fresh copy of the
 * service so its module-level `currentState` reflects the seeded settings.
 */
async function loadService(opts: {
  isPackaged?: boolean;
  store?: Record<string, unknown>;
}) {
  h.state.isPackaged = opts.isPackaged ?? true;
  h.state.store = { ...(opts.store ?? {}) };
  vi.resetModules();
  return import("@backend/services/update-service");
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

describe("update-service Xtra-style startup checks", () => {
  it("checks once at startup and does not poll while the app stays open", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    // Initial schedule runs an immediate due-check (lastCheckAt was 0).
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Advance 23h in 1h ticks — interval (24h) not yet elapsed, no new check.
    vi.advanceTimersByTime(23 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Crossing the 24h mark fires exactly one more check.
    vi.advanceTimersByTime(2 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Run out to ~3 days total: exactly one check per elapsed day, never more
    // than once within any 24h window (ticks hourly, gated on lastCheckAt).
    vi.advanceTimersByTime(3 * DAY);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("a failed startup check restores the timestamp for the next launch", async () => {
    // The immediate due-check rejects (offline); later checks resolve.
    h.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    // Immediate due-check fired and failed.
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    // Flush the rejection + catch so the timestamp is restored to its prior value.
    await vi.advanceTimersByTimeAsync(0);

    // With the bug (failed check leaves lastCheckAt advanced) the next retry
    // would wait a full 24h. With the fix it retries on the very next hourly tick.
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(h.state.store.lastCheckAt).toBe(0);
  });

  it("auto-check OFF: no scheduled checks fire", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    expect(h.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7 * DAY);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
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

  it("frequency changes apply on the next startup", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "weekly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    // Immediate due-check on init (lastCheckAt 0).
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // 48h in: weekly (7d) interval not elapsed → still 1.
    vi.advanceTimersByTime(48 * HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Switch to hourly. setAutoCheck reschedules and re-checks immediately; the
    // last check was 48h ago so the hourly interval is already due → fires now.
    svc.setAutoCheck({ frequency: "hourly" });
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Now on the hourly cadence: one more after the next hour.
    vi.advanceTimersByTime(HOUR);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("enabling auto-check waits until the next startup", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).not.toHaveBeenCalled();

    // Turn it on — schedules + runs an immediate due-check.
    const state = svc.setAutoCheck({ enabled: true });
    expect(state.autoCheckEnabled).toBe(true);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("disabling via setAutoCheck stops further scheduled checks", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "hourly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1); // init due-check

    svc.setAutoCheck({ enabled: false });
    // The immediate setAutoCheck re-schedule is a no-op (disabled), so no extra
    // check, and the cleared timer means nothing fires afterward.
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

  it("hourly frequency still performs only the startup check", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: true, checkFrequency: "hourly", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);

    // Immediate due-check on init.
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // 59 minutes later: under the 1h interval → still 1.
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);

    // Crossing 1h fires exactly one more — never sub-hourly.
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("records lastCheckAt so a recent check is not repeated on init", async () => {
    const recent = new Date("2026-01-01T00:00:00.000Z").getTime() - HOUR;
    const svc = await loadService({
      isPackaged: true,
      // hourly, but the last check was only 1h ago and the floor is 1h, so it
      // sits right at the boundary — use 30m-ago to be safely inside.
      store: {
        autoCheckEnabled: true,
        checkFrequency: "daily",
        lastCheckAt: recent,
      },
    });
    svc.initUpdateService(fakeWindow);

    // Daily interval, last check 1h ago → not due, no check on init.
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("update-service manual check + settings (unaffected by auto-check)", () => {
  it("manual checkForUpdates still works regardless of auto-check state", async () => {
    const svc = await loadService({
      isPackaged: true,
      store: { autoCheckEnabled: false, checkFrequency: "daily", lastCheckAt: 0 },
    });
    svc.initUpdateService(fakeWindow);
    expect(h.checkForUpdates).not.toHaveBeenCalled();

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
