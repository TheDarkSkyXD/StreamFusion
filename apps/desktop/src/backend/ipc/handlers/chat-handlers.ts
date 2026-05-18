import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../../../shared/ipc-channels";

export function registerChatHandlers(): void {
  /**
   * Fetch the v2 chat-history page for a Kick channel. The renderer uses this
   * on join to seed the chat with messages that landed before we connected,
   * matching the official site's behaviour.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_GET_KICK_HISTORY,
    async (_event, params: { channelId: string }) => {
      try {
        const { getKickChannelHistory } = await import(
          "../../api/platforms/kick/endpoints/chat-endpoints"
        );
        const history = await getKickChannelHistory(params.channelId);
        return { success: true, data: history };
      } catch (error) {
        console.error("[ChatHandlers] getKickChannelHistory failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch Kick chat history",
        };
      }
    },
  );

  /**
   * Fetch raw IRC history for a Twitch channel from recent-messages.robotty.de.
   * Used the same way as the Kick handler — seeds the chat with prior context
   * on join. No auth, no Cloudflare guard; just a plain Electron `net` GET.
   */
  ipcMain.handle(
    IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY,
    async (_event, params: { channel: string }) => {
      try {
        const { getTwitchChannelHistory } = await import(
          "../../api/platforms/twitch/endpoints/chat-endpoints"
        );
        const history = await getTwitchChannelHistory(params.channel);
        return { success: true, data: history };
      } catch (error) {
        console.error("[ChatHandlers] getTwitchChannelHistory failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch Twitch chat history",
        };
      }
    },
  );
}
