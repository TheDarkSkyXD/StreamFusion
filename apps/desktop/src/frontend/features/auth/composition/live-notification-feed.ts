import type { LiveNotificationFeed } from "../capabilities/live-notification-feed";
import { electronLiveNotificationFeed } from "../adapters/electron/live-notification-feed";

export function getLiveNotificationFeed(): LiveNotificationFeed | undefined {
  return typeof window !== "undefined" && window.electronAPI?.notifications
    ? electronLiveNotificationFeed
    : undefined;
}
