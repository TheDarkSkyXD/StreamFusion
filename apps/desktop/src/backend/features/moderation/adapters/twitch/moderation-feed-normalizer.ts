import { z } from "zod";
import type {
  ModerationFeedEvent,
  ModerationIdentity,
  RewardRedemption,
} from "@shared/moderation-types";
import type { NotificationPayload } from "@backend/api/platforms/twitch/twitch-eventsub-types";

const user = z.object({ user_id: z.string(), user_login: z.string(), user_name: z.string() });
const anonymousUser = z.object({
  user_id: z.string().nullable(),
  user_login: z.string().nullable(),
  user_name: z.string().nullable(),
});
const channel = z.object({ broadcaster_user_id: z.string() });
const suspicious = channel.extend({ ...user.shape, low_trust_status: z.string() });
const redemption = channel.extend({
  ...user.shape,
  id: z.string(),
  user_input: z.string(),
  status: z.enum(["unfulfilled", "fulfilled", "canceled", "unknown"]),
  redeemed_at: z.string(),
  reward: z.object({ id: z.string(), title: z.string(), cost: z.number() }),
});
const identity = (value: z.infer<typeof user>): ModerationIdentity => ({
  id: value.user_id,
  login: value.user_login,
  displayName: value.user_name,
});
const nullableIdentity = (value: z.infer<typeof anonymousUser>): ModerationIdentity | null =>
  value.user_id && value.user_login && value.user_name
    ? { id: value.user_id, login: value.user_login, displayName: value.user_name }
    : null;

export function normalizeModerationFeedEvent(
  payload: NotificationPayload,
  context: { accountId: string; channelId: string; coverageStartedAt: string }
): ModerationFeedEvent | null {
  const metadata = payload.metadata;
  if (!metadata?.message_id || !metadata.message_timestamp) return null;
  const base = { ...context, id: metadata.message_id, occurredAt: metadata.message_timestamp };
  const type = payload.subscription.type;
  try {
    if (type === "user.whisper.message") {
      const value = z
        .object({
          from_user_id: z.string(),
          from_user_login: z.string(),
          from_user_name: z.string(),
          to_user_id: z.string(),
          to_user_login: z.string(),
          to_user_name: z.string(),
          whisper: z.object({ text: z.string() }),
        })
        .parse(payload.event);
      if (value.to_user_id !== context.accountId) return null;
      return {
        ...base,
        kind: "whisper",
        from: {
          id: value.from_user_id,
          login: value.from_user_login,
          displayName: value.from_user_name,
        },
        to: { id: value.to_user_id, login: value.to_user_login, displayName: value.to_user_name },
        message: value.whisper.text,
      };
    }
    if (type === "channel.raid") {
      const value = z
        .object({
          to_broadcaster_user_id: z.string(),
          from_broadcaster_user_id: z.string(),
          from_broadcaster_user_login: z.string(),
          from_broadcaster_user_name: z.string(),
          viewers: z.number(),
        })
        .parse(payload.event);
      if (value.to_broadcaster_user_id !== context.channelId) return null;
      return {
        ...base,
        kind: "activity",
        action: "raid",
        user: {
          id: value.from_broadcaster_user_id,
          login: value.from_broadcaster_user_login,
          displayName: value.from_broadcaster_user_name,
        },
        count: value.viewers,
        message: "",
      };
    }
    if (channel.parse(payload.event).broadcaster_user_id !== context.channelId) return null;
    switch (type) {
      case "channel.follow":
      case "channel.subscribe": {
        const value = user.parse(payload.event);
        return {
          ...base,
          kind: "activity",
          action: type === "channel.follow" ? "follow" : "subscribe",
          user: identity(value),
          count: null,
          message: "",
        };
      }
      case "channel.subscription.gift": {
        const value = anonymousUser.extend({ total: z.number() }).parse(payload.event);
        return {
          ...base,
          kind: "activity",
          action: "subscription-gift",
          user: nullableIdentity(value),
          count: value.total,
          message: "",
        };
      }
      case "channel.subscription.message": {
        const value = user
          .extend({ cumulative_months: z.number(), message: z.object({ text: z.string() }) })
          .parse(payload.event);
        return {
          ...base,
          kind: "activity",
          action: "subscription-message",
          user: identity(value),
          count: value.cumulative_months,
          message: value.message.text,
        };
      }
      case "channel.cheer": {
        const value = anonymousUser
          .extend({ bits: z.number(), message: z.string() })
          .parse(payload.event);
        return {
          ...base,
          kind: "activity",
          action: "cheer",
          user: nullableIdentity(value),
          count: value.bits,
          message: value.message,
        };
      }
      case "channel.suspicious_user.message": {
        const value = suspicious
          .extend({ message: z.object({ message_id: z.string(), text: z.string() }) })
          .parse(payload.event);
        return {
          ...base,
          kind: "suspicious-message",
          user: identity(value),
          status: value.low_trust_status,
          message: value.message.text,
          messageId: value.message.message_id,
        };
      }
      case "channel.suspicious_user.update": {
        const value = suspicious.parse(payload.event);
        return {
          ...base,
          kind: "suspicious-update",
          user: identity(value),
          status: value.low_trust_status,
        };
      }
      case "channel.channel_points_custom_reward_redemption.add":
      case "channel.channel_points_custom_reward_redemption.update": {
        const value = redemption.parse(payload.event);
        const reward: RewardRedemption = {
          redemptionId: value.id,
          rewardId: value.reward.id,
          rewardTitle: value.reward.title,
          cost: value.reward.cost,
          user: identity(value),
          input: value.user_input,
          status: value.status,
          redeemedAt: value.redeemed_at,
        };
        return { ...base, ...reward, kind: "reward" };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
