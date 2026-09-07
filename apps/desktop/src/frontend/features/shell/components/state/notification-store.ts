import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { LiveNotificationPayload } from "@shared/auth-types";

export interface LiveNotification extends LiveNotificationPayload {
  readAt?: number;
}

export type LiveNotificationInput = LiveNotificationPayload;

interface NotificationState {
  notifications: LiveNotification[];
  addNotification: (notification: LiveNotificationInput) => void;
  markAllRead: () => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

const MAX_LIVE_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],

      addNotification: (notification) => {
        set((state) => {
          const withoutDuplicate = state.notifications.filter(
            (item) => item.id !== notification.id
          );
          const next = [notification, ...withoutDuplicate].slice(0, MAX_LIVE_NOTIFICATIONS);
          return { notifications: next };
        });
      },

      markAllRead: () => {
        const readAt = Date.now();
        set((state) => ({
          notifications: state.notifications.map((notification) => ({
            ...notification,
            readAt: notification.readAt ?? readAt,
          })),
        }));
      },

      dismissNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((item) => item.id !== id),
        }));
      },

      clearNotifications: () => {
        set({ notifications: [] });
      },
    }),
    {
      name: "streamfusion-live-notification-store",
      version: 1,
    }
  )
);
