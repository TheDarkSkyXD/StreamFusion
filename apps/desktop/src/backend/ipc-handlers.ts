/**
 * IPC Handlers for Main Process
 *
 * Handles all IPC messages from the renderer process.
 * This file aggregates handlers from the ipc/handlers directory.
 */

import type { BrowserWindow } from "electron";
import { getBugReportsDir } from "@/backend/logging/log-paths";
import { logger } from "@/backend/logging/logger";
import { twitchAuthService } from "./auth";
import { registerAdBlockHandlers } from "./ipc/handlers/adblock-handlers";
import { registerAppHandlers } from "./ipc/handlers/app-handlers";
import { registerAuthHandlers } from "./ipc/handlers/auth-handlers";
import { registerBugReportHandlers } from "./ipc/handlers/bug-report-handlers";
import { registerCategoryHandlers } from "./ipc/handlers/category-handlers";
import { registerChannelHandlers } from "./ipc/handlers/channel-handlers";
import { registerChatHandlers } from "./ipc/handlers/chat-handlers";
import { registerKickChatHandlers } from "./ipc/handlers/kick-chat-handlers";
import { registerLogHandlers } from "./ipc/handlers/log-handlers";
import { registerModLogHandlers } from "./ipc/handlers/modlog-handlers";
import { setUseWebContentsViews } from "./api/unified/slot-controller";
import { registerPlatformHealthHandlers } from "./ipc/handlers/platform-health-handlers";
import { registerSlotControllerHandlers } from "./ipc/handlers/slot-controller-handlers";
import { applyPersistedProxyOnStart, registerProxyHandlers } from "./ipc/handlers/proxy-handlers";
import { registerSearchHandlers } from "./ipc/handlers/search-handlers";
import { registerStorageHandlers } from "./ipc/handlers/storage-handlers";
import { registerStreamHandlers } from "./ipc/handlers/stream-handlers";
import { registerSystemHandlers } from "./ipc/handlers/system-handlers";
import { registerTokenStatusHandlers } from "./ipc/handlers/token-status-handlers";
import { registerUpdateHandlers } from "./ipc/handlers/update-handlers";
import { registerVideoHandlers } from "./ipc/handlers/video-handlers";

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Register all handlers
  registerSystemHandlers(mainWindow);
  registerAppHandlers();
  registerStorageHandlers();
  registerAuthHandlers(mainWindow);
  registerStreamHandlers();
  registerCategoryHandlers();
  registerSearchHandlers();
  registerChannelHandlers();
  registerChatHandlers();
  registerKickChatHandlers();
  registerModLogHandlers();
  registerVideoHandlers();
  registerAdBlockHandlers(mainWindow);
  registerUpdateHandlers(mainWindow);
  registerProxyHandlers();
  registerPlatformHealthHandlers(mainWindow);
  // Slice 05 (#56) dogfood flag: enables per-slot WebContentsViews when the
  // env var is set. Off by default in production. Set on slot-controller
  // BEFORE the handlers register so the very first createSlot call sees the
  // correct flag value. Will become a runtime setting after slice 06 sign-off.
  if (process.env.STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1") {
    setUseWebContentsViews(true);
    logger.info("IPC:Bootstrap", "WebContentsView-per-slot enabled by env flag");
  }
  registerSlotControllerHandlers(mainWindow);
  registerTokenStatusHandlers();
  registerLogHandlers();
  registerBugReportHandlers(getBugReportsDir());

  // Apply the persisted outbound proxy at boot if the user enabled it (R20).
  // No-op when disabled/empty; never blocks startup (fire-and-forget).
  applyPersistedProxyOnStart();

  // Start the Twitch proactive-refresh timer at boot. If a stored token
  // exists, this schedules a refresh 5 minutes before its expiry so idle
  // sessions don't silently lose IRC / EventSub auth. No-op when there's
  // no token (clean install or post-logout state).
  twitchAuthService.scheduleProactiveRefresh();

  logger.debug("IPC:Bootstrap", "All IPC handlers registered successfully");
}
