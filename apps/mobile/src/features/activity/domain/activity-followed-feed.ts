import type { ActivityItem } from "@streamfusion/core/activity";
import {
  findGuestFollow,
  type GuestFollow,
} from "@streamfusion/core/follows";

/**
 * Drop end-of-stream live-alert rows from Activity.
 * Go-live titles look like "X is live"; ended proof/relay rows used "ended"
 * in the eventId/title/body.
 */
export function isGoLiveActivityItem(item: ActivityItem): boolean {
  if (item.kind !== "channel" || item.event !== "live-alert") return false;
  if (/[:-]ended([:-]|$)/i.test(item.eventId)) return false;
  if (/\bended\b/i.test(item.title) && !/\bis live\b/i.test(item.title)) {
    return false;
  }
  if (
    /stream ended|broken player|opens the channel page instead of a broken player/i.test(
      item.body,
    )
  ) {
    return false;
  }
  return true;
}

/** Activity is a followed go-live feed: channel live-alerts for membership only. */
export function isFollowedLiveAlert(
  item: ActivityItem,
  membership: readonly GuestFollow[],
): boolean {
  if (!isGoLiveActivityItem(item)) return false;
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