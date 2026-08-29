/**
 * AdBlock IPC Handlers
 *
 * Handles IPC messages for network ad blocking and cosmetic injection services.
 */

import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { BrowserWindow } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@backend/logging/logger";
import { cosmeticInjectionService } from "../../services/cosmetic-injection-service";
import { networkAdBlockService } from "../../services/network-adblock-service";
import { twitchManifestProxy } from "../../services/twitch-manifest-proxy";
import { vaftPatternService } from "../../services/vaft-pattern-service";

export function registerAdBlockHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.ADBLOCK_GET_STATUS, async () => {
    return {
      networkBlockingEnabled: networkAdBlockService.isActive(),
      cosmeticFilteringEnabled: cosmeticInjectionService.isActive(),
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.ADBLOCK_TOGGLE,
    async (_event, { network, cosmetic }: { network?: boolean; cosmetic?: boolean }) => {
      if (typeof network === "boolean") {
        if (network) {
          networkAdBlockService.enable();
        } else {
          networkAdBlockService.disable();
        }
      }
      if (typeof cosmetic === "boolean") {
        if (cosmetic) {
          cosmeticInjectionService.enable();
        } else {
          cosmeticInjectionService.disable();
        }
      }
      return {
        networkBlockingEnabled: networkAdBlockService.isActive(),
        cosmeticFilteringEnabled: cosmeticInjectionService.isActive(),
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_GET_STATS, async () => {
    return networkAdBlockService.getStats();
  });

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_PROXY_STATUS, async () => {
    return {
      isActive: twitchManifestProxy.isActive(),
      stats: twitchManifestProxy.getStats(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_INJECT_COSMETICS, async (event) => {
    const result = await cosmeticInjectionService.injectIntoWebContents(event.sender);
    return {
      ...result,
      cosmeticFilteringEnabled: cosmeticInjectionService.isActive(),
    };
  });

  // Stream proxy cleanup handlers - prevents memory leaks from accumulated stream info
  ipcMain.handle(
    IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_STREAM,
    async (_event, { channelName }: { channelName: string }) => {
      twitchManifestProxy.clearStreamInfo(channelName);
      // console.debug(`[AdBlock] Cleared stream info for: ${channelName}`);
      return { success: true };
    }
  );

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_ALL, async () => {
    twitchManifestProxy.clearAllStreamInfos();
    logger.debug("IPC:Adblock", "Cleared all stream infos");
    return { success: true };
  });

  // ========== VAFT Pattern Auto-Update Handlers ==========

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_PATTERNS_GET, async () => {
    return vaftPatternService.getCurrentPatterns();
  });

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH, async () => {
    const patterns = await vaftPatternService.forceRefresh();
    return {
      success: patterns !== null,
      patterns: patterns || vaftPatternService.getCurrentPatterns(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.ADBLOCK_PATTERNS_GET_STATS, async () => {
    return vaftPatternService.getStats();
  });

  ipcMain.handle(
    IPC_CHANNELS.ADBLOCK_PATTERNS_SET_AUTO_UPDATE,
    async (_event, { enabled }: { enabled: boolean }) => {
      vaftPatternService.setAutoUpdateEnabled(enabled);
      return {
        autoUpdateEnabled: vaftPatternService.isAutoUpdateEnabled(),
      };
    }
  );

  logger.debug("IPC:Adblock", "IPC handlers registered");
}
