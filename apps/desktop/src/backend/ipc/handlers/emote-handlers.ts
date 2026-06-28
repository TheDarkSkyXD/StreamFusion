import { ipcMain } from "electron";

import {
  fetch7TVGlobalEmoteSet,
  fetch7TVUserByConnection,
} from "@/backend/services/emotes/7tv-emotes-service";
import {
  fetchBTTVGlobalEmotes,
  fetchBTTVUserByTwitchId,
} from "@/backend/services/emotes/bttv-emotes-service";
import { fetchFFZGlobalEmotes, fetchFFZRoom } from "@/backend/services/emotes/ffz-emotes-service";
import { fetchKickChannelEmotes } from "@/backend/services/emotes/kick-channel-emotes-service";
import { fetchKickUserSubscriptions } from "@/backend/services/emotes/kick-user-subscriptions-service";
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

  ipcMain.handle(IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL, async () => {
    return fetchBTTVGlobalEmotes();
  });

  ipcMain.handle(
    IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID,
    async (
      _event,
      { channelId }: IpcPayloads[typeof IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID]
    ) => {
      return fetchBTTVUserByTwitchId(channelId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL, async () => {
    return fetchFFZGlobalEmotes();
  });

  ipcMain.handle(
    IPC_CHANNELS.EMOTES_FFZ_GET_ROOM,
    async (_event, opts: IpcPayloads[typeof IPC_CHANNELS.EMOTES_FFZ_GET_ROOM]) => {
      return fetchFFZRoom(opts);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES,
    async (
      _event,
      { slug, accessToken }: IpcPayloads[typeof IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES]
    ) => {
      return fetchKickChannelEmotes(slug, accessToken);
    }
  );

  ipcMain.handle(IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS, async () => {
    return fetchKickUserSubscriptions();
  });
}
