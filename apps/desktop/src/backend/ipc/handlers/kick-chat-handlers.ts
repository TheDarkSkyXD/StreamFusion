/**
 * Kick chat IPC handlers.
 *
 * Bridges renderer-side `kickChatService` calls to the main-only `kick-send-window`
 * module. Keeping these on this side of the boundary prevents the renderer
 * bundle from transitively importing electron / better-sqlite3 via
 * `kick-send-window → channel-endpoints → user-endpoints → kick-auth →
 * storage-service → database-service`.
 *
 * See `mod-log-types.ts` for the same pattern.
 */
import { ipcMain } from "electron";

import {
  disposeSendWindow,
  ensureSendWindowReady,
  type KickSendResult,
  sendKickChatMessage,
} from "../../api/platforms/kick/kick-send-window";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";

export function registerKickChatHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY, async (): Promise<void> => {
    await ensureSendWindowReady();
  });

  ipcMain.handle(
    IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE,
    async (
      _event,
      payload: { chatroomId: number; content: string },
    ): Promise<KickSendResult> => {
      return sendKickChatMessage(payload.chatroomId, payload.content);
    },
  );

  ipcMain.handle(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW, async (): Promise<void> => {
    await disposeSendWindow();
  });
}
