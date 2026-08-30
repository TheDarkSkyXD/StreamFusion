/**
 * Platform-health IPC bridge. `PLATFORM_HEALTH_GET` returns the current
 * snapshot for renderer hydration; transitions push `PLATFORM_HEALTH_CHANGED`
 * to the main window. Send guard matches the auth-handlers pattern.
 */

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
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

export interface PlatformHealthSnapshot {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  details?: {
    kick?: StatusPageDetail;
    twitch?: StatusPageDetail;
  };
}

export function registerPlatformHealthHandlers(renderer: MainRendererPort): void {
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

  const unsubscribe = onPlatformHealthChanged((event: PlatformHealthEvent) => {
    renderer.send(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, event);

    if (event.status === "healthy" && event.platform === "kick") {
      clearKickStreamFailureCache();
      logger.info("IPC:PlatformHealth", "Kick recovery: flushed negative stream caches");
    }
  });
  registerLoadedFeatureCleanup("platform-health:events", unsubscribe);

  logger.info("IPC:PlatformHealth", "IPC handlers registered");
}
