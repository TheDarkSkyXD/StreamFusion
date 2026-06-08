import { ipcMain } from "electron";

import {
  fetch7TVGlobalEmoteSet,
  fetch7TVUserByConnection,
} from "@/backend/services/emotes/7tv-emotes-service";
import { IPC_CHANNELS, type IpcPayloads } from "@/shared/ipc-channels";

export function registerEmoteHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION,
    async (
      _event,
      { platform, identifier }: IpcPayloads[typeof IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION]
    ) => {
      return fetch7TVUserByConnection(platform, identifier);
    }
  );

  ipcMain.handle(IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET, async () => {
    return fetch7TVGlobalEmoteSet();
  });
}
