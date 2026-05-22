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

import type { UpdateInfo, UpdateProgress, UpdateState } from "../../shared/ipc-channels";

// Store for update preferences
const updateStore = new Store<{ allowPrerelease: boolean }>({
  name: "update-settings",
  defaults: {
    allowPrerelease: false,
  },
});

// Internal state
let currentState: UpdateState = {
  status: "idle",
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: updateStore.get("allowPrerelease", false),
};

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

  // Auto-check for updates after app is ready (delay to let window load)
  // Only in production builds (not during development)
  if (app.isPackaged) {
    setTimeout(() => {
      console.log("[Update] Auto-checking for updates on startup...");
      checkForUpdates().catch((err) => {
        console.warn("[Update] Auto-check failed:", err);
      });
    }, 5000); // 5 second delay to let the app fully initialize
  } else {
    console.log("[Update] Skipping auto-check in development mode");
  }
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
 * Get update settings
 */
export function getUpdateSettings(): { allowPrerelease: boolean } {
  return {
    allowPrerelease: currentState.allowPrerelease,
  };
}
