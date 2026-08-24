import { z } from "zod";

import type { BTTVBadgeCatalog, FFZBadgeCatalog, FFZRoomResponse } from "../shared/ipc-channels";

const bttvEmoteSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    imageType: z.enum(["png", "gif", "webp"]),
    animated: z.boolean(),
    userId: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        displayName: z.string(),
        providerId: z.string(),
      })
      .strip()
      .optional(),
  })
  .passthrough();
const sevenTvEmoteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    flags: z.number(),
    timestamp: z.number(),
    actor_id: z.string().nullable(),
    data: z
      .object({
        id: z.string(),
        flags: z.number(),
        animated: z.boolean(),
        owner: z
          .object({
            id: z.string(),
            username: z.string(),
            display_name: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
const sevenTvEmoteSetSchema = z
  .object({ id: z.string(), emotes: z.array(sevenTvEmoteSchema) })
  .passthrough();

export const sevenTvUserSchema = z
  .object({
    id: z.string(),
    emote_set: sevenTvEmoteSetSchema.nullable().optional(),
  })
  .passthrough();
export const sevenTvGlobalSetSchema = sevenTvEmoteSetSchema;

export const bttvBadgeCatalogSchema = z.array(
  z
    .object({
      providerId: z.string(),
      badge: z.object({ description: z.string(), svg: z.string() }).strip(),
    })
    .strip()
) satisfies z.ZodType<BTTVBadgeCatalog>;
export const bttvEmoteListSchema = z.array(bttvEmoteSchema);
export const bttvUserSchema = z
  .object({
    channelEmotes: z.array(bttvEmoteSchema),
    sharedEmotes: z.array(bttvEmoteSchema),
  })
  .passthrough();

export type SevenTvUser = z.output<typeof sevenTvUserSchema>;
export type SevenTvEmoteSet = z.output<typeof sevenTvGlobalSetSchema>;
export type BttvEmote = z.output<typeof bttvEmoteSchema>;
export type BttvUser = z.output<typeof bttvUserSchema>;

const ffzUrlsSchema = z
  .object({ "1": z.string(), "2": z.string().optional(), "4": z.string().optional() })
  .strict();
export const ffzBadgeCatalogSchema = z
  .object({
    badges: z.array(
      z
        .object({
          id: z.number(),
          title: z.string(),
          color: z.string(),
          slot: z.number().optional(),
          replaces: z.string().optional(),
          urls: ffzUrlsSchema,
        })
        .strip()
    ),
    users: z.record(z.string(), z.array(z.union([z.string(), z.number()]))),
  })
  .strip() satisfies z.ZodType<FFZBadgeCatalog>;
export const ffzGlobalSchema = z
  .object({ default_sets: z.array(z.number()), sets: z.record(z.string(), z.unknown()) })
  .passthrough();
export const ffzRoomSchema = z
  .object({
    room: z
      .object({
        _id: z.number().optional(),
        twitch_id: z.union([z.number(), z.string()]).optional(),
        id: z.string().optional(),
        is_group: z.boolean().optional(),
        display_name: z.string().optional(),
        set: z.number(),
        vip_badge: ffzUrlsSchema.nullable().optional(),
        mod_urls: ffzUrlsSchema.nullable().optional(),
        moderator_badge: z.string().nullable().optional(),
      })
      .strip(),
    sets: z.record(z.string(), z.unknown()),
  })
  .strip() satisfies z.ZodType<FFZRoomResponse>;
