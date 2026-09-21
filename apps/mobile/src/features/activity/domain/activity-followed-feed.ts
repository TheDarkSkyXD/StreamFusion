import type { ActivityItem } from "@streamfusion/core/activity";
import {
  findGuestFollow,
  type GuestFollow,
} from "@streamfusion/core/follows";

/** Activity is a followed go-live feed: channel live-alerts for membership only. */
export function isFollowedLiveAlert(
  item: ActivityItem,
  membership: readonly GuestFollow[],
): boolean {
  if (item.kind !== "channel" || item.event !== "live-alert") return false;
  // Development Activity proof fixtures stay visible in isolated proof namespaces.
  if (item.eventId.startsWith("proof:")) return true;
  return (
    findGuestFollow(membership, {
      platform: item.channel.platform,
      channelId: item.channel.id,
      channelLogin: item.channel.login,
    }) !== undefined
  );
}

export function filterFollowedLiveAlerts(
  items: readonly ActivityItem[],
  membership: readonly GuestFollow[],
): readonly ActivityItem[] {
  return items.filter((item) => isFollowedLiveAlert(item, membership));
}
