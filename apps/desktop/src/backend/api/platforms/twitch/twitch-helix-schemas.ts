import { z } from "zod";

const paginationSchema = z.object({ cursor: z.string().optional() });

export const twitchUserSchema = z.object({
  id: z.string(),
  login: z.string(),
  display_name: z.string(),
  type: z.enum(["", "admin", "global_mod", "staff"]),
  broadcaster_type: z.enum(["", "affiliate", "partner"]),
  description: z.string(),
  profile_image_url: z.string(),
  offline_image_url: z.string(),
  email: z.string().optional(),
  created_at: z.string(),
});

export const twitchStreamSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  game_id: z.string(),
  game_name: z.string(),
  type: z.enum(["live", ""]),
  title: z.string(),
  viewer_count: z.number(),
  started_at: z.string(),
  language: z.string(),
  thumbnail_url: z.string(),
  tag_ids: z.array(z.string()),
  tags: z.array(z.string()),
  is_mature: z.boolean(),
});

export const twitchChannelSchema = z.object({
  broadcaster_id: z.string(),
  broadcaster_login: z.string(),
  broadcaster_name: z.string(),
  broadcaster_language: z.string(),
  game_id: z.string(),
  game_name: z.string(),
  title: z.string(),
  delay: z.number(),
  tags: z.array(z.string()),
  content_classification_labels: z.array(z.string()),
  is_branded_content: z.boolean(),
});

export const twitchGameSchema = z.object({
  id: z.string(),
  name: z.string(),
  box_art_url: z.string(),
  igdb_id: z.string().optional(),
});

export const twitchFollowedChannelSchema = z.object({
  broadcaster_id: z.string(),
  broadcaster_login: z.string(),
  broadcaster_name: z.string(),
  followed_at: z.string(),
});

export const twitchVideoSchema = z.object({
  id: z.string(),
  stream_id: z.string().nullable(),
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  title: z.string(),
  description: z.string(),
  created_at: z.string(),
  published_at: z.string(),
  url: z.string(),
  thumbnail_url: z.string(),
  viewable: z.enum(["public", "private"]),
  view_count: z.number(),
  language: z.string(),
  type: z.enum(["archive", "highlight", "upload"]),
  duration: z.string(),
  muted_segments: z.array(z.object({ duration: z.number(), offset: z.number() })).nullable(),
  game_id: z.string().optional(),
  game_name: z.string().optional(),
});

export const twitchClipSchema = z.object({
  id: z.string(),
  url: z.string(),
  embed_url: z.string(),
  broadcaster_id: z.string(),
  broadcaster_name: z.string(),
  creator_id: z.string(),
  creator_name: z.string(),
  video_id: z.string(),
  game_id: z.string(),
  language: z.string(),
  title: z.string(),
  view_count: z.number(),
  created_at: z.string(),
  thumbnail_url: z.string(),
  duration: z.number(),
  vod_offset: z.number().nullable(),
  is_featured: z.boolean(),
});

export const twitchSearchChannelSchema = z.object({
  broadcaster_language: z.string(),
  broadcaster_login: z.string(),
  display_name: z.string(),
  game_id: z.string(),
  game_name: z.string(),
  id: z.string(),
  is_live: z.boolean(),
  tags: z.array(z.string()),
  thumbnail_url: z.string(),
  title: z.string(),
  started_at: z.string(),
});

export function helixResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationSchema.optional(),
    total: z.number().optional(),
  });
}
