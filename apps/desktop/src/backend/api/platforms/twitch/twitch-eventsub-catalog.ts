import type { TwitchEventSubEventType } from "./twitch-eventsub-types";
import { TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPE_GROUPS } from "@shared/auth-types";

interface EventSpec {
  version: "1" | "2";
  condition: "channel" | "moderator" | "raid-target" | "account";
  actor: "any" | "broadcaster";
  /** Every group is required; at least one scope within each group suffices. */
  scopes: readonly (readonly string[])[];
}
const channel: EventSpec = { version: "1", condition: "channel", actor: "any", scopes: [] };
const subscriptions: EventSpec = {
  ...channel,
  actor: "broadcaster",
  scopes: [["channel:read:subscriptions"]],
};
const redemptions: EventSpec = {
  ...channel,
  actor: "broadcaster",
  scopes: [["channel:read:redemptions", "channel:manage:redemptions"]],
};
const automod: EventSpec = {
  ...channel,
  version: "2",
  condition: "moderator",
  scopes: [["moderator:manage:automod"]],
};
const suspicious: EventSpec = {
  ...channel,
  condition: "moderator",
  scopes: [["moderator:read:suspicious_users"]],
};

/** Documented WebSocket versions and conditions; no prefix-based version inference. */
export const TWITCH_EVENTSUB_CATALOG = {
  "channel.moderate": {
    ...channel,
    version: "2",
    condition: "moderator",
    scopes: TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPE_GROUPS.map((group) => group.accepted),
  },
  "automod.message.hold": automod,
  "automod.message.update": automod,
  "stream.online": channel,
  "stream.offline": channel,
  "channel.follow": {
    ...channel,
    version: "2",
    condition: "moderator",
    scopes: [["moderator:read:followers"]],
  },
  "channel.subscribe": subscriptions,
  "channel.subscription.gift": subscriptions,
  "channel.subscription.message": subscriptions,
  "channel.cheer": { ...channel, actor: "broadcaster", scopes: [["bits:read"]] },
  "channel.raid": { ...channel, condition: "raid-target" },
  "channel.suspicious_user.message": suspicious,
  "channel.suspicious_user.update": suspicious,
  "user.whisper.message": {
    ...channel,
    condition: "account",
    scopes: [["user:read:whispers", "user:manage:whispers"]],
  },
  "channel.channel_points_custom_reward_redemption.add": redemptions,
  "channel.channel_points_custom_reward_redemption.update": redemptions,
} satisfies Record<TwitchEventSubEventType, EventSpec>;

export function eventSubCondition(
  type: TwitchEventSubEventType,
  channelId: string,
  userId: string
): Record<string, string> {
  switch (TWITCH_EVENTSUB_CATALOG[type].condition) {
    case "channel":
      return { broadcaster_user_id: channelId };
    case "moderator":
      return { broadcaster_user_id: channelId, moderator_user_id: userId };
    case "raid-target":
      return { to_broadcaster_user_id: channelId };
    case "account":
      return { user_id: userId };
  }
}

export function eventSubRoutingId(
  type: TwitchEventSubEventType,
  condition: Record<string, unknown>
): string | null {
  const spec = TWITCH_EVENTSUB_CATALOG[type];
  if (!spec) return null;
  const value =
    condition[
      spec.condition === "account"
        ? "user_id"
        : spec.condition === "raid-target"
          ? "to_broadcaster_user_id"
          : "broadcaster_user_id"
    ];
  return typeof value === "string" ? value : null;
}
