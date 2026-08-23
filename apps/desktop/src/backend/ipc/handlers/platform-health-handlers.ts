/**
 * Platform-health IPC bridge. `PLATFORM_HEALTH_GET` returns the current
 * snapshot for renderer hydration; transitions push `PLATFORM_HEALTH_CHANGED`
 * to the main window. Send guard matches the auth-handlers pattern.
 */

import type { BrowserWindow } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { clearKickStreamFailureCache } from "../../api/platforms/kick/endpoints/stream-endpoints";
import {
  getPlatformHealth,
  getPlatformStatusPageDetail,
  onPlatformHealthChanged,
  type PlatformHealth,
  type PlatformHealthEvent,
  type StatusPageDetail,
} from "../../api/unified/platform-health";
import { logger } from "../../logging/logger";

export interface PlatformHealthSnapshot {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  details?: {
    kick?: StatusPageDetail;
    twitch?: StatusPageDetail;
  };
}

export function registerPlatformHealthHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.PLATFORM_HEALTH_GET, (): PlatformHealthSnapshot => {
    const snapshot: PlatformHealthSnapshot = {
      kick: getPlatformHealth("kick"),
      twitch: getPlatformHealth("twitch"),
    };
    const kickDetail = getPlatformStatusPageDetail("kick");
    const twitchDetail = getPlatformStatusPageDetail("twitch");
    if (kickDetail != null || twitchDetail != null) {
      snapshot.details = {};
      if (kickDetail != null) snapshot.details.kick = kickDetail;
      if (twitchDetail != null) snapshot.details.twitch = twitchDetail;
    }
    return snapshot;
  });

  function pushTransitionToRenderer(event: PlatformHealthEvent): void {
    try {
      if (mainWindow.isDestroyed()) return;
      const { webContents } = mainWindow;
      if (webContents.isDestroyed() || webContents.isCrashed()) return;
      const { mainFrame } = webContents;
      if (mainFrame.isDestroyed() || mainFrame.detached) return;
      mainFrame.send(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, event);
    } catch (error) {
      logger.warn("IPC:PlatformHealth", "Could not push transition", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  onPlatformHealthChanged((event) => {
    pushTransitionToRenderer(event);

    if (event.status === "healthy" && event.platform === "kick") {
      clearKickStreamFailureCache();
      logger.info("IPC:PlatformHealth", "Kick recovery: flushed negative stream caches");
    }
  });

  logger.info("IPC:PlatformHealth", "IPC handlers registered");
}
