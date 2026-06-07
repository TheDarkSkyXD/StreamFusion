/**
 * Platform-health IPC bridge. `PLATFORM_HEALTH_GET` returns the current
 * snapshot for renderer hydration; transitions push `PLATFORM_HEALTH_CHANGED`
 * to the main window. Send guard matches the auth-handlers pattern.
 */

import { type BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { clearKickStreamFailureCache } from "../../api/platforms/kick/endpoints/stream-endpoints";
import {
  getPlatformHealth,
  onPlatformHealthChanged,
  type PlatformHealth,
} from "../../api/unified/platform-health";
import { logger } from "../../logging/logger";

export interface PlatformHealthSnapshot {
  kick: PlatformHealth;
  twitch: PlatformHealth;
}

export function registerPlatformHealthHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.PLATFORM_HEALTH_GET, (): PlatformHealthSnapshot => {
    return {
      kick: getPlatformHealth("kick"),
      twitch: getPlatformHealth("twitch"),
    };
  });

  onPlatformHealthChanged((event) => {
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, event);
      }
    } catch (error) {
      logger.warn("IPC:PlatformHealth", "Could not push transition", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (event.status === "healthy" && event.platform === "kick") {
      clearKickStreamFailureCache();
      logger.info("IPC:PlatformHealth", "Kick recovery: flushed negative stream caches");
    }
  });

  logger.info("IPC:PlatformHealth", "IPC handlers registered");
}
