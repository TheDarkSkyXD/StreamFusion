/**
 * Update Service
 *
 * Handles app auto-update functionality using electron-updater.
 * Supports both stable and pre-release channels.
 */

import { app } from "electron";
import Store from "electron-store";
import {
  autoUpdater,
  type UpdateInfo as ElectronUpdateInfo,
  type ProgressInfo,
} from "electron-updater";
import { logger } from "@backend/logging/logger";
import type {
  CheckFrequency,
  UpdateInfo,
  UpdateProgress,
  UpdateSettings,
  UpdateState,
} from "../../../../../shared/ipc-channels";
import { IPC_CHANNELS } from "../../../../../shared/ipc-channels";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import { registerLoadedFeatureCleanup } from "@backend/startup/loaded-feature-cleanup";
import { createManagedInterval } from "@shared/utils/managed-interval";

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
  lastCheckAt: number;
  updateCheckUrl: string;
}

const DEFAULT_CHECK_FREQUENCY: CheckFrequency = "weekly";
export const DEFAULT_UPDATE_CHECK_URL =
  "https://github.com/TheDarkSkyXD/StreamFusion/releases/latest/download";

// How long each preset waits between checks, in milliseconds.
const FREQUENCY_INTERVAL_MS: Record<CheckFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

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
    updateCheckUrl: DEFAULT_UPDATE_CHECK_URL,
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
  updateCheckUrl: updateStore.get("updateCheckUrl", DEFAULT_UPDATE_CHECK_URL),
};

let rendererRef: MainRendererPort | null = null;

// Flag to track if the service was initialized successfully
let isInitialized = false;
let pendingCheck: Promise<UpdateState> | null = null;
let periodicCheck: { stop: () => void } | null = null;

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
  rendererRef?.send(IPC_CHANNELS.UPDATE_ON_STATUS_CHANGE, currentState);
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
export function initUpdateService(renderer: MainRendererPort): void {
  rendererRef = renderer;
  if (isInitialized) return;

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Manual download control
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = currentState.allowPrerelease;
  autoUpdater.setFeedURL({ provider: "generic", url: currentState.updateCheckUrl });

  // Set up event listeners
  autoUpdater.on("checking-for-update", () => {
    logger.info("Service:Updater", "Checking for updates");
    updateState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info: ElectronUpdateInfo) => {
    logger.info("Service:Updater", "Update available", { version: info.version });
    updateState({
      status: "available",
      updateInfo: transformUpdateInfo(info),
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info: ElectronUpdateInfo) => {
    logger.info("Service:Updater", "No update available. Current version is latest", {
      version: info.version,
    });
    updateState({
      status: "not-available",
      updateInfo: transformUpdateInfo(info),
      error: null,
    });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    logger.info("Service:Updater", "Download progress", {
      percent: Number(progress.percent.toFixed(1)),
    });
    updateState({
      status: "downloading",
      progress: transformProgress(progress),
    });

    // Also send dedicated progress event
    rendererRef?.send(IPC_CHANNELS.UPDATE_ON_PROGRESS, transformProgress(progress));
  });

  autoUpdater.on("update-downloaded", (info: ElectronUpdateInfo) => {
    logger.info("Service:Updater", "Update downloaded", { version: info.version });
    updateState({
      status: "downloaded",
      updateInfo: transformUpdateInfo(info),
      progress: null,
    });
  });

  autoUpdater.on("error", (error: Error) => {
    logger.error("Service:Updater", "Auto-updater error", {
      error: { name: error.name, message: error.message, stack: error.stack },
    });
    updateState({
      status: "error",
      error: error.message,
      progress: null,
    });
  });

  logger.info("Service:Updater", "Update service initialized");
  isInitialized = true;
  registerLoadedFeatureCleanup("updates", () => {
    periodicCheck?.stop();
    periodicCheck = null;
  });

  if (app.isPackaged) {
    void checkForUpdates();
    schedulePeriodicChecks();
  }
}

function schedulePeriodicChecks(): void {
  periodicCheck?.stop();
  periodicCheck = null;
  if (!isInitialized || !app.isPackaged || !currentState.autoCheckEnabled) return;

  periodicCheck = createManagedInterval(
    () => {
      if (
        pendingCheck ||
        currentState.status === "available" ||
        currentState.status === "downloading" ||
        currentState.status === "downloaded"
      )
        return;
      const lastCheckAt = updateStore.get("lastCheckAt", 0);
      if (Date.now() - lastCheckAt >= effectiveIntervalMs(currentState.checkFrequency)) {
        void checkForUpdates();
      }
    },
    MIN_INTERVAL_MS,
    { unref: true }
  );
}

/**
 * Check for updates
 */
export function checkForUpdates(): Promise<UpdateState> {
  if (!isInitialized) {
    const message = "Update service not initialized (development mode)";
    logger.warn("Service:Updater", message);
    return Promise.resolve({ ...currentState, status: "error", error: message });
  }

  if (pendingCheck) return pendingCheck;
  pendingCheck = (async () => {
    try {
      await autoUpdater.checkForUpdates();
      if (currentState.status !== "error") updateStore.set("lastCheckAt", Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check for updates";
      updateState({ status: "error", error: message });
    }
    return currentState;
  })().finally(() => {
    pendingCheck = null;
  });
  return pendingCheck;
}

/**
 * Download the available update
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!isInitialized) {
    const message = "Update service not initialized (development mode)";
    logger.warn("Service:Updater", message);
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
 * Set whether the app keeps checking after the launch check, and the interval.
 */
export function setAutoCheck(settings: {
  enabled?: boolean;
  frequency?: CheckFrequency;
  updateCheckUrl?: string;
}): UpdateState {
  if (typeof settings.enabled === "boolean") {
    updateStore.set("autoCheckEnabled", settings.enabled);
    currentState = { ...currentState, autoCheckEnabled: settings.enabled };
  }
  if (settings.frequency) {
    updateStore.set("checkFrequency", settings.frequency);
    currentState = { ...currentState, checkFrequency: settings.frequency };
  }
  if (settings.updateCheckUrl) {
    updateStore.set("updateCheckUrl", settings.updateCheckUrl);
    currentState = { ...currentState, updateCheckUrl: settings.updateCheckUrl };
    if (isInitialized) {
      autoUpdater.setFeedURL({ provider: "generic", url: settings.updateCheckUrl });
    }
  }
  schedulePeriodicChecks();

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
    updateCheckUrl: currentState.updateCheckUrl,
  };
}
