import type { LiveNotificationFeed } from "../../capabilities/live-notification-feed";

export const electronLiveNotificationFeed = {
  onLiveNotification: (callback: Parameters<typeof window.electronAPI.notifications.onLiveNotification>[0]) =>
    window.electronAPI.notifications.onLiveNotification(callback),
  onOpenLiveNotification: (
    callback: Parameters<typeof window.electronAPI.notifications.onOpenLiveNotification>[0]
  ) => window.electronAPI.notifications.onOpenLiveNotification(callback),
} satisfies LiveNotificationFeed;
