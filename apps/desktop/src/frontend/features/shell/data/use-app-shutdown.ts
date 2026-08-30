import { useEffect } from "react";

import { logger } from "@/renderer/logging/logger";
import { useChatStore } from "../../../store/chat-store";
import { runAppShutdownTasks } from "../utils/app-shutdown-registry";

/**
 * Subscribes to the main-process `app:before-quit` push and tears down
 * renderer resources without importing optional features into the app root.
 * Main enforces the final three-second process deadline if acknowledgement
 * through the normal window-close route cannot complete.
 */
export function useAppShutdown(): void {
  useEffect(() => {
    const onBeforeQuit = window.electronAPI?.onBeforeQuit;
    if (typeof onBeforeQuit !== "function") return undefined;

    const cleanup = onBeforeQuit(() => {
      (window as unknown as { __shuttingDown?: boolean }).__shuttingDown = true;
      try {
        runAppShutdownTasks();
      } catch (error) {
        logger.warn("Hook:AppShutdown", "Feature cleanup failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        useChatStore.getState().cleanupBatching();
      } catch (error) {
        logger.warn("Hook:AppShutdown", "Chat cleanup failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        window.electronAPI?.closeWindow?.();
      }
    });
    return cleanup;
  }, []);
}
