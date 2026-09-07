import { z } from "zod";

export const moderationIdentitySchema = z.object({
  id: z.string(),
  login: z.string(),
  displayName: z.string(),
});
export type ModerationIdentity = z.infer<typeof moderationIdentitySchema>;
export const EDITABLE_CONTENT_CLASSIFICATION_LABELS = [
  "DebatedSocialIssuesAndPolitics",
  "DrugsIntoxication",
  "SexualThemes",
  "ViolentGraphic",
  "Gambling",
  "ProfanityVulgarity",
] as const;
export const streamInfoSchema = z.object({
  broadcasterId: z.string(),
  title: z.string(),
  category: z.object({ id: z.string(), name: z.string() }),
  language: z.string(),
  tags: z.array(z.string()),
  contentClassificationLabels: z.array(z.string()),
  availableContentClassificationLabels: z.array(
    z.object({
      id: z.enum(EDITABLE_CONTENT_CLASSIFICATION_LABELS),
      name: z.string(),
      description: z.string(),
    })
  ),
});
export type StreamInfo = z.infer<typeof streamInfoSchema>;
export const streamInfoUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    categoryId: z.string().regex(/^\d*$/).max(128).optional(),
    language: z
      .string()
      .regex(/^(?:[a-z]{2}|other)$/)
      .optional(),
    tags: z
      .array(
        z
          .string()
          .min(1)
          .max(25)
          .regex(/^[\p{L}\p{N}]+$/u)
      )
      .max(10)
      .optional(),
    contentClassificationLabels: z
      .array(
        z
          .object({
            id: z.enum(EDITABLE_CONTENT_CLASSIFICATION_LABELS),
            enabled: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(6)
      .refine(
        (labels) => new Set(labels.map((label) => label.id)).size === labels.length,
        "Each content label may appear only once."
      )
      .optional(),
  })
  .strict()
  .refine(
    (settings) => Object.values(settings).some((value) => value !== undefined),
    "Choose at least one stream property."
  );
export type StreamInfoUpdate = z.infer<typeof streamInfoUpdateSchema>;
export const streamInfoUpdateResultSchema = z.object({ updated: z.literal(true) });
export const shieldStateSchema = z.object({
  active: z.boolean(),
  moderator: moderationIdentitySchema,
  lastActivatedAt: z.string(),
});
export type ShieldState = z.infer<typeof shieldStateSchema>;
export const autoModPolicySchema = z.object({
  overallLevel: z.number().int().min(0).max(4).nullable(),
  levels: z.object({
    aggression: z.number(),
    bullying: z.number(),
    disability: z.number(),
    misogyny: z.number(),
    raceEthnicityOrReligion: z.number(),
    sexBasedTerms: z.number(),
    sexualitySexOrGender: z.number(),
    swearing: z.number(),
  }),
});
export type AutoModPolicy = z.infer<typeof autoModPolicySchema>;
export interface AutoModSettingsUpdate {
  overall_level?: number;
  aggression?: number;
  bullying?: number;
  disability?: number;
  misogyny?: number;
  race_ethnicity_or_religion?: number;
  sex_based_terms?: number;
  sexuality_sex_or_gender?: number;
  swearing?: number;
}
export const blockedTermSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type BlockedTerm = z.infer<typeof blockedTermSchema>;
export const blockedTermsPageSchema = z.object({
  items: z.array(blockedTermSchema),
  cursor: z.string().nullable(),
});
export const chattersPageSchema = z.object({
  items: z.array(moderationIdentitySchema),
  cursor: z.string().nullable(),
  total: z.number(),
  observedAt: z.string(),
});
export type ChattersPage = z.infer<typeof chattersPageSchema>;
export const activeModeratorsPageSchema = chattersPageSchema.extend({
  coverage: z.literal("chatters-page"),
  rosterComplete: z.boolean(),
});
export type ActiveModeratorsPage = z.infer<typeof activeModeratorsPageSchema>;
export const manageableRewardsSchema = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string(), cost: z.number() })),
});
export const rewardRedemptionSchema = z.object({
  redemptionId: z.string(),
  rewardId: z.string(),
  rewardTitle: z.string(),
  cost: z.number(),
  user: moderationIdentitySchema,
  input: z.string(),
  status: z.enum(["unfulfilled", "fulfilled", "canceled", "unknown"]),
  redeemedAt: z.string(),
});
export type RewardRedemption = z.infer<typeof rewardRedemptionSchema>;
export const rewardRedemptionsPageSchema = z.object({
  items: z.array(rewardRedemptionSchema),
  cursor: z.string().nullable(),
});
export const suspiciousUserStatusSchema = z.object({
  userId: z.string(),
  status: z.enum(["ACTIVE_MONITORING", "RESTRICTED", "NO_TREATMENT"]),
  updatedAt: z.string(),
});
export type ModerationReadCommand =
  | { operation: "get-stream-info"; broadcasterId: string }
  | { operation: "update-stream-info"; broadcasterId: string; settings: StreamInfoUpdate }
  | {
      operation: "set-suspicious-user-status";
      broadcasterId: string;
      moderatorId: string;
      userId: string;
      status: "ACTIVE_MONITORING" | "RESTRICTED" | "NO_TREATMENT";
    }
  | {
      operation: "update-reward-redemption";
      broadcasterId: string;
      rewardId: string;
      redemptionId: string;
      status: "FULFILLED" | "CANCELED";
    }
  | {
      operation: "get-shield-mode" | "get-automod-settings";
      broadcasterId: string;
      moderatorId: string;
    }
  | {
      operation: "update-automod-settings";
      broadcasterId: string;
      moderatorId: string;
      settings: AutoModSettingsUpdate;
    }
  | {
      operation: "get-blocked-terms" | "get-chatters" | "get-active-moderators";
      broadcasterId: string;
      moderatorId: string;
      after?: string;
    }
  | { operation: "add-blocked-term"; broadcasterId: string; moderatorId: string; text: string }
  | { operation: "remove-blocked-term"; broadcasterId: string; moderatorId: string; termId: string }
  | { operation: "get-manageable-rewards"; broadcasterId: string }
  | {
      operation: "get-reward-redemptions";
      broadcasterId: string;
      rewardId: string;
      after?: string;
    };

export const MODERATION_FEED_EVENT_TYPES = [
  "channel.follow",
  "channel.subscribe",
  "channel.subscription.gift",
  "channel.subscription.message",
  "channel.cheer",
  "channel.raid",
  "channel.suspicious_user.message",
  "channel.suspicious_user.update",
  "user.whisper.message",
  "channel.channel_points_custom_reward_redemption.add",
  "channel.channel_points_custom_reward_redemption.update",
] as const;
export type ModerationFeedEventType = (typeof MODERATION_FEED_EVENT_TYPES)[number];
export type ModerationEventSubType =
  ModerationFeedEventType | "channel.moderate" | "automod.message.hold" | "automod.message.update";
export interface ModerationFeedStart {
  feedId: string;
  userId: string;
  channelId: string;
  eventTypes?: ModerationEventSubType[];
}
const feedBase = {
  id: z.string(),
  accountId: z.string(),
  channelId: z.string(),
  occurredAt: z.string(),
  coverageStartedAt: z.string(),
};
export const moderationFeedEventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...feedBase,
    kind: z.literal("activity"),
    action: z.enum([
      "follow",
      "subscribe",
      "subscription-gift",
      "subscription-message",
      "cheer",
      "raid",
    ]),
    user: moderationIdentitySchema.nullable(),
    count: z.number().nullable(),
    message: z.string(),
  }),
  z.object({
    ...feedBase,
    kind: z.literal("suspicious-message"),
    user: moderationIdentitySchema,
    status: z.string(),
    message: z.string(),
    messageId: z.string(),
  }),
  z.object({
    ...feedBase,
    kind: z.literal("suspicious-update"),
    user: moderationIdentitySchema,
    status: z.string(),
  }),
  z.object({
    ...feedBase,
    kind: z.literal("whisper"),
    from: moderationIdentitySchema,
    to: moderationIdentitySchema,
    message: z.string(),
  }),
  z.object({ ...feedBase, ...rewardRedemptionSchema.shape, kind: z.literal("reward") }),
]);
export type ModerationFeedEvent = z.infer<typeof moderationFeedEventSchema>;
