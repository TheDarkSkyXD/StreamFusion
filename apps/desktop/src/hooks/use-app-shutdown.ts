import { useEffect } from "react";

import { runAppShutdownTasks } from "./app-shutdown-registry";

/**
 * Subscribes to the main-process `app:before-quit` push and tears down
 * renderer resources without importing optional features into the app root.
 * Main enforces the final three-second process deadline.
 */
export function useAppShutdown(): void {
  useEffect(() => {
    const onBeforeQuit = window.electronAPI?.onBeforeQuit;
    if (typeof onBeforeQuit !== "function") return undefined;

    const cleanup = onBeforeQuit(() => {
      (window as unknown as { __shuttingDown?: boolean }).__shuttingDown = true;
      runAppShutdownTasks();
      void import("../store/chat-store")
        .then(({ useChatStore }) => useChatStore.getState().cleanupBatching())
        .catch(() => undefined);
    });
    return cleanup;
  }, []);
}
