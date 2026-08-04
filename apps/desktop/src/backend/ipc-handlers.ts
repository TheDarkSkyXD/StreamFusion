/**
 * IPC Handlers for Main Process
 *
 * Handles all IPC messages from the renderer process.
 * This file aggregates handlers from the ipc/handlers directory.
 */

import type { BrowserWindow } from "electron";
import { getBugReportsDir } from "@/backend/logging/log-paths";
import { logger } from "@/backend/logging/logger";
import { setUseWebContentsViews } from "./api/unified/slot-controller";
import { twitchAuthService } from "./auth";
import { registerAdBlockHandlers } from "./ipc/handlers/adblock-handlers";
import { registerAppHandlers } from "./ipc/handlers/app-handlers";
import { registerAuthHandlers } from "./ipc/handlers/auth-handlers";
import { registerBugReportHandlers } from "./ipc/handlers/bug-report-handlers";
import { registerCategoryHandlers } from "./ipc/handlers/category-handlers";
import { registerChannelHandlers } from "./ipc/handlers/channel-handlers";
import { registerChatEligibilityHandlers } from "./ipc/handlers/chat-eligibility-handlers";
import { registerChatHandlers } from "./ipc/handlers/chat-handlers";
import { registerChatReplayHandlers } from "./ipc/handlers/chat-replay-handlers";
import { registerConnectivityHandlers } from "./ipc/handlers/connectivity-handlers";
import { registerDownloadHandlers } from "./ipc/handlers/download-handlers";
import { registerEmoteHandlers } from "./ipc/handlers/emote-handlers";
import { registerKickChatHandlers } from "./ipc/handlers/kick-chat-handlers";
import { registerLocalCaptionHandlers } from "./ipc/handlers/local-caption-handlers";
import { registerLogHandlers } from "./ipc/handlers/log-handlers";
import { registerModLogHandlers } from "./ipc/handlers/modlog-handlers";
import { registerPlatformHealthHandlers } from "./ipc/handlers/platform-health-handlers";
import { applyPersistedProxyOnStart, registerProxyHandlers } from "./ipc/handlers/proxy-handlers";
import { registerSearchHandlers } from "./ipc/handlers/search-handlers";
import { registerSlotControllerHandlers } from "./ipc/handlers/slot-controller-handlers";
import { registerStorageHandlers } from "./ipc/handlers/storage-handlers";
import { registerStreamRecordingHandlers } from "./ipc/handlers/stream-recording-handlers";
import { registerStreamHandlers } from "./ipc/handlers/stream-handlers";
import { registerSystemHandlers } from "./ipc/handlers/system-handlers";
import { registerTimeoutModerationHandlers } from "./ipc/handlers/timeout-moderation-handlers";
import { registerTokenStatusHandlers } from "./ipc/handlers/token-status-handlers";
import { registerTwitchApiHandlers } from "./ipc/handlers/twitch-api-handlers";
import { registerUpdateHandlers } from "./ipc/handlers/update-handlers";
import { registerUserProfileHandlers } from "./ipc/handlers/user-profile-handlers";
import { registerVideoHandlers } from "./ipc/handlers/video-handlers";
import { getLocalCaptionRuntime } from "./services/captions/local-caption-runtime";
import { kickFollowWriteService } from "./services/kick-follow-write-service";

function registerIpcHandlerGroup(group: string, registrar: () => void): void {
  try {
    registrar();
  } catch (error) {
    logger.error("IPC:Bootstrap", "Failed to register IPC handler group", {
      group,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
    });
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Register all handlers
  registerIpcHandlerGroup("system", () => registerSystemHandlers(mainWindow));
  registerIpcHandlerGroup("app", registerAppHandlers);
  registerIpcHandlerGroup("storage", () => {
    registerStorageHandlers(mainWindow);
    kickFollowWriteService.resumePendingWrites();
  });
  registerIpcHandlerGroup("auth", () => registerAuthHandlers(mainWindow));
  registerIpcHandlerGroup("stream", registerStreamHandlers);
  registerIpcHandlerGroup("category", registerCategoryHandlers);
  registerIpcHandlerGroup("search", registerSearchHandlers);
  registerIpcHandlerGroup("channel", registerChannelHandlers);
  registerIpcHandlerGroup("chat", registerChatHandlers);
  registerIpcHandlerGroup("chat-replay", registerChatReplayHandlers);
  registerIpcHandlerGroup("connectivity", registerConnectivityHandlers);
  registerIpcHandlerGroup("download", () => registerDownloadHandlers(mainWindow));
  registerIpcHandlerGroup("stream-recording", () => registerStreamRecordingHandlers(mainWindow));
  registerIpcHandlerGroup("local-caption", () =>
    registerLocalCaptionHandlers(mainWindow, getLocalCaptionRuntime(mainWindow))
  );
  registerIpcHandlerGroup("chat-eligibility", registerChatEligibilityHandlers);
  registerIpcHandlerGroup("kick-chat", registerKickChatHandlers);
  registerIpcHandlerGroup("emote", registerEmoteHandlers);
  registerIpcHandlerGroup("mod-log", registerModLogHandlers);
  registerIpcHandlerGroup("video", registerVideoHandlers);
  registerIpcHandlerGroup("ad-block", () => registerAdBlockHandlers(mainWindow));
  registerIpcHandlerGroup("update", () => registerUpdateHandlers(mainWindow));
  registerIpcHandlerGroup("proxy", registerProxyHandlers);
  registerIpcHandlerGroup("platform-health", () => registerPlatformHealthHandlers(mainWindow));
  // Slice 05 (#56) dogfood flag: enables per-slot WebContentsViews when the
  // env var is set. Off by default in production. Set on slot-controller
  // BEFORE the handlers register so the very first createSlot call sees the
  // correct flag value. Will become a runtime setting after slice 06 sign-off.
  if (process.env.STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1") {
    setUseWebContentsViews(true);
    logger.info("IPC:Bootstrap", "WebContentsView-per-slot enabled by env flag");
  }
  registerIpcHandlerGroup("slot-controller", () => registerSlotControllerHandlers(mainWindow));
  registerIpcHandlerGroup("token-status", registerTokenStatusHandlers);
  registerIpcHandlerGroup("timeout-moderation", registerTimeoutModerationHandlers);
  registerIpcHandlerGroup("twitch-api", () => registerTwitchApiHandlers({ mainWindow }));
  registerIpcHandlerGroup("user-profile", registerUserProfileHandlers);
  registerIpcHandlerGroup("log", registerLogHandlers);
  registerIpcHandlerGroup("bug-report", () => registerBugReportHandlers(getBugReportsDir()));

  // Apply the persisted outbound proxy at boot if the user enabled it (R20).
  // No-op when disabled/empty; never blocks startup (fire-and-forget).
  applyPersistedProxyOnStart();

  // Start the Twitch proactive-refresh timer at boot. If a stored token
  // exists, this schedules a refresh 5 minutes before its expiry so idle
  // sessions don't silently lose IRC / EventSub auth. No-op when there's
  // no token (clean install or post-logout state).
  twitchAuthService.scheduleProactiveRefresh();

  logger.debug("IPC:Bootstrap", "IPC handler registration pass completed");
}
