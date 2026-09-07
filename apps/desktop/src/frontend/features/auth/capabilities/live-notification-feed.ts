import type { LiveNotificationPayload } from "@shared/auth-types";

export interface LiveNotificationFeed {
  onLiveNotification(callback: (notification: LiveNotificationPayload) => void): () => void;
  onOpenLiveNotification(callback: (notification: LiveNotificationPayload) => void): () => void;
}
