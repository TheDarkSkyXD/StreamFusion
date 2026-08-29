/**
 * Update IPC Handlers
 *
 * Handles IPC communication for app auto-update functionality.
 */

import type { BrowserWindow } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { logger } from "@backend/logging/logger";
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
  DEFAULT_UPDATE_CHECK_URL,
} from "../../services/update-service";

const VALID_FREQUENCIES: readonly CheckFrequency[] = ["hourly", "daily", "weekly"];

function serializeError(error: unknown): Record<string, unknown> {
  return {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  };
}

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  // IMPORTANT: Register IPC handlers FIRST, before initializing the service
  // This ensures handlers are available even if the update service fails to initialize
  // (which happens in development mode when electron-updater can't find app-update.yml)

  // Check for updates
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    try {
      return await checkForUpdates();
    } catch (error) {
      logger.error("IPC:Update", "Check failed", serializeError(error));
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
      logger.error("IPC:Update", "Download failed", serializeError(error));
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
      logger.error("IPC:Update", "Install failed", serializeError(error));
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
      logger.error("IPC:Update", "Get status failed", serializeError(error));
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
        logger.error("IPC:Update", "Set prerelease failed", serializeError(error));
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
    (_event, payload: { enabled?: boolean; frequency?: CheckFrequency; updateCheckUrl?: string } = {}) => {
      const settings: { enabled?: boolean; frequency?: CheckFrequency; updateCheckUrl?: string } = {};
      if (typeof payload.enabled === "boolean") {
        settings.enabled = payload.enabled;
      }
      if (typeof payload.frequency === "string" && VALID_FREQUENCIES.includes(payload.frequency)) {
        settings.frequency = payload.frequency;
      }
      if (typeof payload.updateCheckUrl === "string") {
        try {
          const url = new URL(payload.updateCheckUrl.trim());
          if (url.protocol === "https:") settings.updateCheckUrl = url.toString().replace(/\/$/, "");
        } catch {
          // Invalid renderer input is ignored at the IPC boundary.
        }
      }
      try {
        return setAutoCheck(settings);
      } catch (error) {
        logger.error("IPC:Update", "Set auto-check failed", serializeError(error));
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
      logger.error("IPC:Update", "Get settings failed", serializeError(error));
      return { allowPrerelease: false, autoCheckEnabled: false, checkFrequency: "weekly", updateCheckUrl: DEFAULT_UPDATE_CHECK_URL };
    }
  });

  logger.info("IPC:Update", "IPC handlers registered");

  // NOW initialize the update service (after handlers are registered)
  // Wrap in try-catch to prevent initialization errors from breaking the app
  try {
    initUpdateService(mainWindow);
    logger.info("IPC:Update", "Update service initialized");
  } catch (error) {
    logger.warn(
      "IPC:Update",
      "Update service initialization failed (this is normal in development)",
      serializeError(error)
    );
  }
}
