import { z } from "zod";

import type { BTTVBadgeCatalog, FFZBadgeCatalog, FFZRoomResponse } from "@/shared/ipc-channels";

const emoteSchema = z.object({ id: z.string(), code: z.string().optional() }).passthrough();

export const sevenTvUserSchema = z
  .object({
    id: z.string(),
    emote_set: z
      .object({ emotes: z.array(emoteSchema) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export const sevenTvGlobalSetSchema = z
  .object({ id: z.string(), emotes: z.array(emoteSchema) })
  .passthrough();

export const bttvBadgeCatalogSchema = z.array(
  z
    .object({
      providerId: z.string(),
      badge: z.object({ description: z.string(), svg: z.string() }).strict(),
    })
    .strict()
) satisfies z.ZodType<BTTVBadgeCatalog>;
export const bttvEmoteListSchema = z.array(emoteSchema);
export const bttvUserSchema = z
  .object({ channelEmotes: z.array(emoteSchema), sharedEmotes: z.array(emoteSchema) })
  .passthrough();

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
        .strict()
    ),
    users: z.record(z.string(), z.array(z.union([z.string(), z.number()]))),
  })
  .strict() satisfies z.ZodType<FFZBadgeCatalog>;
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
      .strict(),
    sets: z.record(z.string(), z.unknown()),
  })
  .strict() satisfies z.ZodType<FFZRoomResponse>;
