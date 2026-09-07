import type { ModerationFeedEvent, ModerationFeedEventType } from "@shared/moderation-types";
export type WorkspaceFeedKind = "activity" | "suspicious" | "whispers" | "rewards";
export const WORKSPACE_FEED_LIMIT = 100;
export function appendWorkspaceEvent(
  events: readonly ModerationFeedEvent[],
  event: ModerationFeedEvent
): ModerationFeedEvent[] {
  return [event, ...events.filter((item) => item.id !== event.id)].slice(0, WORKSPACE_FEED_LIMIT);
}
export function workspaceFeedPlan(
  kind: WorkspaceFeedKind,
  ownChannel: boolean,
  scopes: readonly string[]
): { events: ModerationFeedEventType[]; missingScopes: string[] } {
  const has = (scope: string) => scopes.includes(scope);
  if (kind === "rewards") {
    const granted = has("channel:read:redemptions") || has("channel:manage:redemptions");
    return {
      events:
        ownChannel && granted
          ? [
              "channel.channel_points_custom_reward_redemption.add",
              "channel.channel_points_custom_reward_redemption.update",
            ]
          : [],
      missingScopes: granted ? [] : ["channel:read:redemptions"],
    };
  }
  if (kind === "whispers")
    return {
      events:
        has("user:read:whispers") || has("user:manage:whispers") ? ["user.whisper.message"] : [],
      missingScopes:
        has("user:read:whispers") || has("user:manage:whispers") ? [] : ["user:read:whispers"],
    };
  if (kind === "suspicious")
    return {
      events: has("moderator:read:suspicious_users")
        ? ["channel.suspicious_user.message", "channel.suspicious_user.update"]
        : [],
      missingScopes: has("moderator:read:suspicious_users")
        ? []
        : ["moderator:read:suspicious_users"],
    };
  const events: ModerationFeedEventType[] = ["channel.raid"];
  const missingScopes: string[] = [];
  if (has("moderator:read:followers")) events.push("channel.follow");
  else missingScopes.push("moderator:read:followers");
  if (ownChannel) {
    if (has("channel:read:subscriptions"))
      events.push("channel.subscribe", "channel.subscription.gift", "channel.subscription.message");
    else missingScopes.push("channel:read:subscriptions");
    if (has("bits:read")) events.push("channel.cheer");
    else missingScopes.push("bits:read");
  }
  return { events, missingScopes };
}
export function acceptsWorkspaceEvent(
  kind: WorkspaceFeedKind,
  event: ModerationFeedEvent,
  actorId: string,
  channelId: string
): boolean {
  if (event.accountId !== actorId || event.channelId !== channelId) return false;
  if (kind === "rewards") return event.kind === "reward";
  return kind === "activity"
    ? event.kind === "activity"
    : kind === "whispers"
      ? event.kind === "whisper"
      : event.kind === "suspicious-message" || event.kind === "suspicious-update";
}
