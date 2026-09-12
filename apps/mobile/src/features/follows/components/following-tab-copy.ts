import type { FollowingTab, TabItems } from "../capabilities/following-session";

export function tabItemsCopy<T>(
  tab: FollowingTab,
  items: TabItems<T>,
): string {
  if (items.kind === "loading") {
    return tab === "live"
      ? "Loading live Guest Follows from Twitch and Kick."
      : `Loading ${tab} for your Guest Follows.`;
  }
  if (items.kind === "empty" && items.reason === "no-membership") {
    return "Follow channels as a guest. They stay on this device.";
  }
  if (items.kind === "empty" && items.reason === "none-live") {
    return "None of your Guest Follows are live right now.";
  }
  if (items.kind === "empty") {
    return "No Guest Follows match this search or filter.";
  }
  if (items.kind === "unsupported") {
    return "Kick does not offer videos and clips through StreamFusion yet.";
  }
  if (items.kind === "failed" && items.offline) {
    return "You're offline. Guest Follows are saved on this device.";
  }
  if (items.kind === "failed") {
    return tab === "live"
      ? "Live Guest Follows could not be loaded."
      : `${tab} for your Guest Follows could not be loaded.`;
  }
  if (items.kind === "partial") {
    return items.stale
      ? "Some platforms could not refresh. Showing saved live channels."
      : "Some platforms could not refresh. Live channels still shown.";
  }
  return readyCopy(tab, items.stale);
}

function readyCopy(tab: FollowingTab, stale: boolean): string {
  if (stale) {
    return tab === "live"
      ? "Showing saved live channels while a refresh is unavailable."
      : `Showing saved ${tab} while a refresh is unavailable.`;
  }
  if (tab === "live") return "Live Guest Follows from Twitch and Kick.";
  if (tab === "videos") return "Recent videos from a Guest Follow.";
  if (tab === "clips") return "Clips from a Guest Follow.";
  if (tab === "categories") {
    return "Categories your live Guest Follows are in.";
  }
  return "Guest Follows on this device. Live channels stay first.";
}
