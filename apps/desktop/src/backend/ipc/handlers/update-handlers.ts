/**
 * Update IPC Handlers
 *
 * Handles IPC communication for app auto-update functionality.
 */

import { type BrowserWindow, ipcMain } from "electron";
import type { CheckFrequency } from "../../../shared/ipc-channels";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateSettings,
  getUpdateStatus,
  initUpdateService,
  installUpdate,
  setAllowPrerelease,
  setAutoCheck,
} from "../../services/update-service";

const VALID_FREQUENCIES: readonly CheckFrequency[] = ["hourly", "daily", "weekly"];

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  // IMPORTANT: Register IPC handlers FIRST, before initializing the service
  // This ensures handlers are available even if the update service fails to initialize
  // (which happens in development mode when electron-updater can't find app-update.yml)

  // Check for updates
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    try {
      return await checkForUpdates();
    } catch (error) {
      console.error("[Update] Check failed:", error);
      return {
        status: "error",
        updateInfo: null,
        progress: null,
        error: error instanceof Error ? error.message : "Failed to check for updates",
        allowPrerelease: false,
        autoCheckEnabled: false,
        checkFrequency: "daily" as CheckFrequency,
      };
    }
  });

  // Download available update
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    try {
      return await downloadUpdate();
    } catch (error) {
      console.error("[Update] Download failed:", error);
      return {
        status: "error",
        updateInfo: null,
        progress: null,
        error: error instanceof Error ? error.message : "Failed to download update",
        allowPrerelease: false,
      };
    }
  });

  // Install downloaded update (quits and restarts)
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    try {
      // Verify an update is actually downloaded before attempting install
      const { status } = getUpdateStatus();
      if (status !== "downloaded") {
        return { success: false, error: "No downloaded update to install" };
      }
      installUpdate();
      return { success: true };
    } catch (error) {
      console.error("[Update] Install failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to install update",
      };
    }
  });

  // Get current update status
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATUS, () => {
    try {
      return getUpdateStatus();
    } catch (error) {
      console.error("[Update] Get status failed:", error);
      return {
        status: "error",
        updateInfo: null,
        progress: null,
        error: error instanceof Error ? error.message : "Failed to get update status",
        allowPrerelease: false,
        autoCheckEnabled: false,
        checkFrequency: "daily" as CheckFrequency,
      };
    }
  });

  // Set allow pre-release preference
  // Defensively validate payload to prevent crashes if renderer passes undefined
  ipcMain.handle(
    IPC_CHANNELS.UPDATE_SET_ALLOW_PRERELEASE,
    (_event, payload: { allow?: boolean } = {}) => {
      // Validate that allow is a boolean
      if (typeof payload.allow !== "boolean") {
        return {
          status: "error",
          updateInfo: null,
          progress: null,
          error: "Invalid payload: allow must be a boolean",
          allowPrerelease: false,
          autoCheckEnabled: false,
          checkFrequency: "daily" as CheckFrequency,
        };
      }
      try {
        return setAllowPrerelease(payload.allow);
      } catch (error) {
        console.error("[Update] Set prerelease failed:", error);
        return {
          status: "error",
          updateInfo: null,
          progress: null,
          error: error instanceof Error ? error.message : "Failed to set prerelease preference",
          allowPrerelease: false,
          autoCheckEnabled: false,
          checkFrequency: "daily" as CheckFrequency,
        };
      }
    }
  );

  // Set auto-check toggle and/or frequency (U15)
  // Defensively validate the payload — a bad frequency falls through unset
  // (the service clamps the effective interval regardless).
  ipcMain.handle(
    IPC_CHANNELS.UPDATE_SET_AUTO_CHECK,
    (_event, payload: { enabled?: boolean; frequency?: CheckFrequency } = {}) => {
      const settings: { enabled?: boolean; frequency?: CheckFrequency } = {};
      if (typeof payload.enabled === "boolean") {
        settings.enabled = payload.enabled;
      }
      if (typeof payload.frequency === "string" && VALID_FREQUENCIES.includes(payload.frequency)) {
        settings.frequency = payload.frequency;
      }
      try {
        return setAutoCheck(settings);
      } catch (error) {
        console.error("[Update] Set auto-check failed:", error);
        return {
          status: "error",
          updateInfo: null,
          progress: null,
          error: error instanceof Error ? error.message : "Failed to set auto-check settings",
          allowPrerelease: false,
          autoCheckEnabled: false,
          checkFrequency: "daily" as CheckFrequency,
        };
      }
    }
  );

  // Get update settings
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_SETTINGS, () => {
    try {
      return getUpdateSettings();
    } catch (error) {
      console.error("[Update] Get settings failed:", error);
      return { allowPrerelease: false, autoCheckEnabled: false, checkFrequency: "daily" };
    }
  });

  console.log("[Update] IPC handlers registered");

  // NOW initialize the update service (after handlers are registered)
  // Wrap in try-catch to prevent initialization errors from breaking the app
  try {
    initUpdateService(mainWindow);
    console.log("[Update] Update service initialized");
  } catch (error) {
    console.warn(
      "[Update] Update service initialization failed (this is normal in development):",
      error
    );
  }
}
