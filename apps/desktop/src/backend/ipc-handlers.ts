/**
 * IPC Handlers for Main Process
 *
 * Handles all IPC messages from the renderer process.
 * This file aggregates handlers from the ipc/handlers directory.
 */

import type { BrowserWindow } from "electron";

import { twitchAuthService } from "./auth";
import { registerAdBlockHandlers } from "./ipc/handlers/adblock-handlers";
import { registerAuthHandlers } from "./ipc/handlers/auth-handlers";
import { registerCategoryHandlers } from "./ipc/handlers/category-handlers";
import { registerChannelHandlers } from "./ipc/handlers/channel-handlers";
import { registerChatHandlers } from "./ipc/handlers/chat-handlers";
import { registerModLogHandlers } from "./ipc/handlers/modlog-handlers";
import { registerSearchHandlers } from "./ipc/handlers/search-handlers";
import { registerStorageHandlers } from "./ipc/handlers/storage-handlers";
import { registerStreamHandlers } from "./ipc/handlers/stream-handlers";
import { registerSystemHandlers } from "./ipc/handlers/system-handlers";
import { registerUpdateHandlers } from "./ipc/handlers/update-handlers";
import { registerVideoHandlers } from "./ipc/handlers/video-handlers";

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Register all handlers
  registerSystemHandlers(mainWindow);
  registerStorageHandlers();
  registerAuthHandlers(mainWindow);
  registerStreamHandlers();
  registerCategoryHandlers();
  registerSearchHandlers();
  registerChannelHandlers();
  registerChatHandlers();
  registerModLogHandlers();
  registerVideoHandlers();
  registerAdBlockHandlers(mainWindow);
  registerUpdateHandlers(mainWindow);

  // Start the Twitch proactive-refresh timer at boot. If a stored token
  // exists, this schedules a refresh 5 minutes before its expiry so idle
  // sessions don't silently lose IRC / EventSub auth. No-op when there's
  // no token (clean install or post-logout state).
  twitchAuthService.scheduleProactiveRefresh();

  console.debug("✅ All IPC handlers registered successfully");
}
