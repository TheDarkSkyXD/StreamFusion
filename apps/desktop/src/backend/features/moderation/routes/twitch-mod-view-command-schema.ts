import { z } from "zod";
import { streamInfoUpdateSchema } from "@shared/moderation-types";

const id = z.string().trim().min(1).max(128);
const actor = { broadcasterId: id, moderatorId: id };
const level = z.number().int().min(0).max(4).optional();
const settings = z
  .object({
    overall_level: level,
    aggression: level,
    bullying: level,
    disability: level,
    misogyny: level,
    race_ethnicity_or_religion: level,
    sex_based_terms: level,
    sexuality_sex_or_gender: level,
    swearing: level,
  })
  .strict()
  .refine((value) => {
    const keys = Object.keys(value);
    return keys.length > 0 && (value.overall_level === undefined || keys.length === 1);
  }, "Choose an overall level or individual category levels.");
export const twitchModViewCommandSchemas = [
  z
    .object({
      operation: z.literal("get-stream-info"),
      broadcasterId: z.string().regex(/^\d+$/).max(128),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update-stream-info"),
      broadcasterId: z.string().regex(/^\d+$/).max(128),
      settings: streamInfoUpdateSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("set-suspicious-user-status"),
      ...actor,
      userId: id,
      status: z.enum(["ACTIVE_MONITORING", "RESTRICTED", "NO_TREATMENT"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update-reward-redemption"),
      broadcasterId: id,
      rewardId: id,
      redemptionId: id,
      status: z.enum(["FULFILLED", "CANCELED"]),
    })
    .strict(),
  z.object({ operation: z.enum(["get-shield-mode", "get-automod-settings"]), ...actor }).strict(),
  z.object({ operation: z.literal("update-automod-settings"), ...actor, settings }).strict(),
  z
    .object({
      operation: z.enum(["get-blocked-terms", "get-chatters", "get-active-moderators"]),
      ...actor,
      after: z.string().max(8192).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("add-blocked-term"),
      ...actor,
      text: z.string().trim().min(2).max(500),
    })
    .strict(),
  z.object({ operation: z.literal("remove-blocked-term"), ...actor, termId: id }).strict(),
  z.object({ operation: z.literal("get-manageable-rewards"), broadcasterId: id }).strict(),
  z
    .object({
      operation: z.literal("get-reward-redemptions"),
      broadcasterId: id,
      rewardId: id,
      after: z.string().max(8192).optional(),
    })
    .strict(),
] as const;
