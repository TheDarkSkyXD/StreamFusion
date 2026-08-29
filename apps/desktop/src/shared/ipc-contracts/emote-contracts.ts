import { z } from "zod";

import {
  bttvBadgeCatalogSchema,
  bttvEmoteListSchema,
  bttvUserSchema,
  ffzBadgeCatalogSchema,
  ffzGlobalSchema,
  ffzRoomSchema,
  sevenTvGlobalSetSchema,
  sevenTvUserSchema,
} from "./third-party-emote-schemas";
import { IPC_CHANNELS } from "../ipc-channels";
import { ipcReplySchema } from "./reliability-contracts";

const identifierSchema = z.string().trim().min(1).max(256);
const noRequestSchema = z.undefined();
const sevenTvConnectionRequestSchema = z
  .object({
    platform: z.enum(["twitch", "kick"]),
    identifier: identifierSchema,
  })
  .strict();
const channelIdRequestSchema = z.object({ channelId: identifierSchema }).strict();
const ffzRoomRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name"), name: identifierSchema }).strict(),
  z.object({ kind: z.literal("channel-id"), channelId: identifierSchema }).strict(),
]);
const kickChannelRequestSchema = z
  .object({ slug: identifierSchema, accessToken: z.string().min(1).optional() })
  .strict();
const kickChannelResponseSchema = z
  .object({ emoteSets: z.unknown().optional(), channelData: z.unknown().optional() })
  .strip()
  .nullable();

export const emoteIpcContracts = {
  [IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION]: {
    request: sevenTvConnectionRequestSchema,
    response: ipcReplySchema(sevenTvUserSchema.nullable()),
  },
  [IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET]: {
    request: noRequestSchema,
    response: ipcReplySchema(sevenTvGlobalSetSchema),
  },
  [IPC_CHANNELS.EMOTES_BTTV_GET_BADGES]: {
    request: noRequestSchema,
    response: ipcReplySchema(bttvBadgeCatalogSchema),
  },
  [IPC_CHANNELS.EMOTES_BTTV_GET_GLOBAL]: {
    request: noRequestSchema,
    response: ipcReplySchema(bttvEmoteListSchema),
  },
  [IPC_CHANNELS.EMOTES_BTTV_GET_USER_BY_TWITCH_ID]: {
    request: channelIdRequestSchema,
    response: ipcReplySchema(bttvUserSchema.nullable()),
  },
  [IPC_CHANNELS.EMOTES_FFZ_GET_BADGES]: {
    request: noRequestSchema,
    response: ipcReplySchema(ffzBadgeCatalogSchema),
  },
  [IPC_CHANNELS.EMOTES_FFZ_GET_GLOBAL]: {
    request: noRequestSchema,
    response: ipcReplySchema(ffzGlobalSchema),
  },
  [IPC_CHANNELS.EMOTES_FFZ_GET_ROOM]: {
    request: ffzRoomRequestSchema,
    response: ipcReplySchema(ffzRoomSchema.nullable()),
  },
  [IPC_CHANNELS.EMOTES_KICK_GET_CHANNEL_EMOTES]: {
    request: kickChannelRequestSchema,
    response: ipcReplySchema(kickChannelResponseSchema),
  },
  [IPC_CHANNELS.EMOTES_KICK_GET_USER_SUBSCRIPTIONS]: {
    request: noRequestSchema,
    response: ipcReplySchema(z.unknown().nullable()),
  },
} as const;

export type EmoteIpcChannel = keyof typeof emoteIpcContracts;
export type EmoteIpcRequest<Channel extends EmoteIpcChannel> = z.input<
  (typeof emoteIpcContracts)[Channel]["request"]
>;
export type EmoteIpcResponse<Channel extends EmoteIpcChannel> = z.output<
  (typeof emoteIpcContracts)[Channel]["response"]
>;
export type FfzRoomRequest = z.output<typeof ffzRoomRequestSchema>;
