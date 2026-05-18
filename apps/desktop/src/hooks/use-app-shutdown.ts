import { useEffect } from "react";

import { kickChatService } from "../backend/services/chat/kick-chat";
import { twitchChatService } from "../backend/services/chat/twitch-chat";
import { useChatStore } from "../store/chat-store";

/**
 * Subscribes to the main-process `app:before-quit` push and tears down
 * expensive renderer resources (chat sockets, batched message timers) as
 * fast as possible. The flag on `window.__shuttingDown` lets other modules
 * (e.g. the HLS player teardown) skip cleanup that's pointless when the
 * process is about to die.
 *
 * Mounts once in `App.tsx`. Main hard-kills the renderer 3s after the push
 * either way; this hook just makes the common case finish in under 300ms.
 */
export function useAppShutdown(): void {
  useEffect(() => {
    const cleanup = window.electronAPI.onBeforeQuit(() => {
      (window as unknown as { __shuttingDown?: boolean }).__shuttingDown = true;
      // Fire-and-forget: we don't wait on these. Main's 3s timer is the floor.
      void kickChatService.forceShutdown().catch(() => undefined);
      void twitchChatService.forceShutdown().catch(() => undefined);
      try {
        useChatStore.getState().cleanupBatching();
      } catch {
        // Store may already be torn down — ignore.
      }
    });
    return cleanup;
  }, []);
}
