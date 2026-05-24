/**
 * Update Service
 *
 * Handles app auto-update functionality using electron-updater.
 * Supports both stable and pre-release channels.
 */

import { app, type BrowserWindow } from "electron";
import Store from "electron-store";
import {
  autoUpdater,
  type UpdateInfo as ElectronUpdateInfo,
  type ProgressInfo,
} from "electron-updater";

import type {
  CheckFrequency,
  UpdateInfo,
  UpdateProgress,
  UpdateSettings,
  UpdateState,
} from "../../shared/ipc-channels";

/**
 * Persisted shape of the existing `update-settings` store. `allowPrerelease`
 * predates U15; `autoCheckEnabled` / `checkFrequency` / `lastCheckAt` were added
 * for the auto-check scheduler and live in the SAME store (not a new
 * UserPreferences group) to stay consistent with `allowPrerelease`.
 */
interface UpdateStoreSchema {
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: CheckFrequency;
  /** Unix-ms timestamp of the last completed check; gates the interval. */
  lastCheckAt: number;
}

const DEFAULT_CHECK_FREQUENCY: CheckFrequency = "daily";

// How long each preset waits between checks, in milliseconds.
const FREQUENCY_INTERVAL_MS: Record<CheckFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// Floor for the effective interval so a tampered/unknown frequency can't spin a
// check loop. Also the cadence the scheduler ticks at (it re-checks the
// last-check timestamp each tick, firing only once the interval has elapsed).
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Map a (possibly bad) frequency to its interval, clamped to the 1-hour floor.
 * Exported for direct unit testing of the clamp/fallback (no side effects).
 */
export function effectiveIntervalMs(frequency: CheckFrequency): number {
  const raw = FREQUENCY_INTERVAL_MS[frequency] ?? FREQUENCY_INTERVAL_MS[DEFAULT_CHECK_FREQUENCY];
  return Math.max(raw, MIN_INTERVAL_MS);
}

// Store for update preferences
// projectName is required at runtime — see storage-service for the full
// regression note. Fires at module load before Electron's app name is set.
const updateStore = new Store<UpdateStoreSchema>({
  projectName: "streamfusion",
  name: "update-settings",
  defaults: {
    allowPrerelease: false,
    autoCheckEnabled: false,
    checkFrequency: DEFAULT_CHECK_FREQUENCY,
    lastCheckAt: 0,
  },
} as ConstructorParameters<typeof Store<UpdateStoreSchema>>[0]);

// Internal state
let currentState: UpdateState = {
  status: "idle",
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: updateStore.get("allowPrerelease", false),
  autoCheckEnabled: updateStore.get("autoCheckEnabled", false),
  checkFrequency: updateStore.get("checkFrequency", DEFAULT_CHECK_FREQUENCY),
};

// Handle for the auto-check interval timer (null when not scheduled).
let autoCheckTimer: ReturnType<typeof setInterval> | null = null;

// Reference to main window for sending updates
let mainWindowRef: BrowserWindow | null = null;

// Flag to track if the service was initialized successfully
let isInitialized = false;

/**
 * Transform electron-updater's UpdateInfo to our format
 */
function transformUpdateInfo(info: ElectronUpdateInfo): UpdateInfo {
  // Release notes can be string or array of release note objects
  let releaseNotes: string | null = null;
  if (info.releaseNotes) {
    if (typeof info.releaseNotes === "string") {
      releaseNotes = info.releaseNotes;
    } else if (Array.isArray(info.releaseNotes)) {
      // Join multiple release notes
      releaseNotes = info.releaseNotes
        .map((note) => (typeof note === "string" ? note : note.note))
        .join("\n\n");
    }
  }

  return {
    version: info.version,
    releaseDate: info.releaseDate || new Date().toISOString(),
    releaseNotes,
    releaseName: info.releaseName || `v${info.version}`,
  };
}

/**
 * Transform progress info
 */
function transformProgress(info: ProgressInfo): UpdateProgress {
  return {
    bytesPerSecond: info.bytesPerSecond,
    percent: info.percent,
    transferred: info.transferred,
    total: info.total,
  };
}

/**
 * Notify renderer of state changes
 */
function notifyStatusChange(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("update:on-status-change", currentState);
  }
}

/**
 * Update the internal state and notify renderer
 */
function updateState(partial: Partial<UpdateState>): void {
  currentState = { ...currentState, ...partial };
  notifyStatusChange();
}

/**
 * Initialize the update service
 */
export function initUpdateService(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Manual download control
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = currentState.allowPrerelease;

  // Set up event listeners
  autoUpdater.on("checking-for-update", () => {
    console.log("[Update] Checking for updates...");
    updateState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info: ElectronUpdateInfo) => {
    console.log("[Update] Update available:", info.version);
    updateState({
      status: "available",
      updateInfo: transformUpdateInfo(info),
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info: ElectronUpdateInfo) => {
    console.log("[Update] No update available. Current version is latest:", info.version);
    updateState({
      status: "not-available",
      updateInfo: transformUpdateInfo(info),
      error: null,
    });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    console.log(`[Update] Download progress: ${progress.percent.toFixed(1)}%`);
    updateState({
      status: "downloading",
      progress: transformProgress(progress),
    });

    // Also send dedicated progress event
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send("update:on-progress", transformProgress(progress));
    }
  });

  autoUpdater.on("update-downloaded", (info: ElectronUpdateInfo) => {
    console.log("[Update] Update downloaded:", info.version);
    updateState({
      status: "downloaded",
      updateInfo: transformUpdateInfo(info),
      progress: null,
    });
  });

  autoUpdater.on("error", (error: Error) => {
    console.error("[Update] Error:", error.message);
    updateState({
      status: "error",
      error: error.message,
      progress: null,
    });
  });

  console.log("[Update] Update service initialized");
  isInitialized = true;

  // Start (or skip) the auto-check scheduler based on the persisted setting.
  // Gated on app.isPackaged so dev builds never poll the update feed.
  startAutoCheckScheduler();
}

/**
 * Run one automatic check, recording the timestamp so the interval gate fires at
 * most once per effective interval. Separate from manual `checkForUpdates` so a
 * manual check doesn't reset the auto cadence and a failed auto-check doesn't
 * leave a stale timestamp blocking retries.
 */
async function runAutoCheck(): Promise<void> {
  // Claim the interval slot synchronously so a concurrent tick can't double-fire,
  // but remember the prior timestamp: a failed/offline check restores it so the
  // next tick (MIN_INTERVAL_MS) retries instead of blocking checks for a whole
  // effective interval.
  const prevCheckAt = updateStore.get("lastCheckAt", 0);
  updateStore.set("lastCheckAt", Date.now());
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    updateStore.set("lastCheckAt", prevCheckAt);
    console.warn("[Update] Auto-check failed:", err);
  }
}

/**
 * Tick handler: fire an automatic check only once the effective interval has
 * elapsed since the last recorded check. Runs on a fixed MIN_INTERVAL_MS cadence
 * so even "weekly" stays self-correcting without a long-lived timer.
 */
function maybeRunScheduledCheck(): void {
  const interval = effectiveIntervalMs(currentState.checkFrequency);
  const lastCheckAt = updateStore.get("lastCheckAt", 0);
  if (Date.now() - lastCheckAt >= interval) {
    void runAutoCheck();
  }
}

/**
 * (Re)build the auto-check interval timer from the current settings. Clears any
 * existing timer first so a settings change reschedules without a restart. No
 * timer runs when auto-check is off, the service isn't initialized, or the build
 * isn't packaged (dev never polls the feed).
 */
function startAutoCheckScheduler(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }

  if (!isInitialized || !currentState.autoCheckEnabled || !app.isPackaged) {
    if (!app.isPackaged) {
      console.log("[Update] Skipping auto-check scheduler in development mode");
    }
    return;
  }

  // Tick at the 1-hour floor and gate each tick on the last-check timestamp, so
  // the effective cadence honors the frequency while a bad value can't spin a
  // sub-hour loop. Check once on (re)schedule too, so enabling it doesn't wait a
  // full tick when a check is already due.
  maybeRunScheduledCheck();
  autoCheckTimer = setInterval(maybeRunScheduledCheck, MIN_INTERVAL_MS);
  console.log(
    `[Update] Auto-check scheduler started (frequency=${currentState.checkFrequency})`
  );
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!isInitialized) {
    const message = "Update service not initialized (development mode)";
    console.warn("[Update]", message);
    return { ...currentState, status: "error", error: message };
  }

  try {
    await autoUpdater.checkForUpdates();
    return currentState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check for updates";
    updateState({ status: "error", error: message });
    return currentState;
  }
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!isInitialized) {
    const message = "Update service not initialized (development mode)";
    console.warn("[Update]", message);
    return { ...currentState, status: "error", error: message };
  }

  if (currentState.status !== "available") {
    return currentState;
  }

  try {
    updateState({ status: "downloading", progress: null });
    await autoUpdater.downloadUpdate();
    return currentState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download update";
    updateState({ status: "error", error: message });
    return currentState;
  }
}

/**
 * Install the downloaded update and restart
 */
export function installUpdate(): void {
  if (currentState.status === "downloaded") {
    autoUpdater.quitAndInstall();
  }
}

/**
 * Get current update state
 */
export function getUpdateStatus(): UpdateState {
  return currentState;
}

/**
 * Set whether to allow pre-release updates
 */
export function setAllowPrerelease(allow: boolean): UpdateState {
  // Update the store regardless of initialization state
  updateStore.set("allowPrerelease", allow);
  currentState = { ...currentState, allowPrerelease: allow };

  // Only update autoUpdater if initialized
  if (isInitialized) {
    autoUpdater.allowPrerelease = allow;
  }

  return currentState;
}

/**
 * Set whether the app auto-checks for updates on an interval, and/or the
 * check frequency. Either argument may be omitted to update only the other.
 * Reschedules the interval timer immediately (no restart needed).
 */
export function setAutoCheck(settings: {
  enabled?: boolean;
  frequency?: CheckFrequency;
}): UpdateState {
  if (typeof settings.enabled === "boolean") {
    updateStore.set("autoCheckEnabled", settings.enabled);
    currentState = { ...currentState, autoCheckEnabled: settings.enabled };
  }
  if (settings.frequency) {
    updateStore.set("checkFrequency", settings.frequency);
    currentState = { ...currentState, checkFrequency: settings.frequency };
  }

  // Rebuild the timer from the new settings (no-op when not initialized / not
  // packaged / disabled — handled inside).
  startAutoCheckScheduler();

  // Mirror the settings change to the renderer (matches setAllowPrerelease,
  // which surfaces via the returned state; this also pushes a status event).
  notifyStatusChange();

  return currentState;
}

/**
 * Get update settings
 */
export function getUpdateSettings(): UpdateSettings {
  return {
    allowPrerelease: currentState.allowPrerelease,
    autoCheckEnabled: currentState.autoCheckEnabled,
    checkFrequency: currentState.checkFrequency,
  };
}
