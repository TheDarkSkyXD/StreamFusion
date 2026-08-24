import {
  fetch7TVGlobalEmoteSet,
  fetch7TVUserByConnection,
} from "@/backend/services/emotes/7tv-emotes-service";
import {
  fetchBTTVBadges,
  fetchBTTVGlobalEmotes,
  fetchBTTVUserByTwitchId,
} from "@/backend/services/emotes/bttv-emotes-service";
import {
  fetchFFZBadges,
  fetchFFZGlobalEmotes,
  fetchFFZRoom,
} from "@/backend/services/emotes/ffz-emotes-service";
import { fetchKickChannelEmotes } from "@/backend/services/emotes/kick-channel-emotes-service";
import { fetchKickUserSubscriptions } from "@/backend/services/emotes/kick-user-subscriptions-service";
import { emoteIpcContracts } from "@/ipc-contracts/emote-contracts";
import { IPC_CHANNELS } from "@/shared/ipc-channels";
import { readEmoteReply } from "../emote-ipc-reply";
import type { TrustedIpcRegistry } from "../trusted-ipc-registry";

export function registerEmoteHandlers(registry: TrustedIpcRegistry): void {
  registry.handle({
    channel: IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, { platform, identifier }) =>
      readEmoteReply("7tv", () => fetch7TVUserByConnection(platform, identifier), platform),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("7tv", fetch7TVGlobalEmoteSet),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_BTTV_GET_BADGES,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_BTTV_GET_BADGES],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("bttv", fetchBTTVBadges, "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("bttv", fetchBTTVGlobalEmotes, "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, { channelId }) =>
      readEmoteReply("bttv", () => fetchBTTVUserByTwitchId(channelId), "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_FFZ_GET_BADGES,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_FFZ_GET_BADGES],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("ffz", fetchFFZBadges, "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("ffz", fetchFFZGlobalEmotes, "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_FFZ_GET_ROOM,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_FFZ_GET_ROOM],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, request) =>
      readEmoteReply("ffz", () => fetchFFZRoom(request), "twitch"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, { slug, accessToken }) =>
      readEmoteReply("kick", () => fetchKickChannelEmotes(slug, accessToken), "kick"),
  });

  registry.handle({
    channel: IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS,
    contract: emoteIpcContracts[IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS],
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async () => readEmoteReply("kick", fetchKickUserSubscriptions, "kick"),
  });
}
