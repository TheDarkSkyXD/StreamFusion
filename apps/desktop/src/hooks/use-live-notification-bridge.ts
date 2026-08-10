import { createElement, useEffect } from "react";
import { toast } from "sonner";

import { LiveNotificationToast } from "@/components/LiveNotificationToast";
import { getNotificationPreferences } from "@/lib/live-notification-preferences";
import { router } from "@/routes/router";
import { useAuthStore } from "@/store/auth-store";
import { useNotificationStore } from "@/store/notification-store";

export function useLiveNotificationBridge(): void {
  useEffect(() => {
    const unsubscribeLive = window.electronAPI?.notifications?.onLiveNotification?.(
      (notification) => {
        useNotificationStore.getState().addNotification(notification);
        const preferences = getNotificationPreferences(
          useAuthStore.getState().preferences?.notifications
        );
        if (preferences.toastAlerts) {
          toast(createElement(LiveNotificationToast, { notification }), {
            action: {
              label: "Watch",
              onClick: () => {
                void router.navigate({
                  to: "/stream/$platform/$channel",
                  params: {
                    platform: notification.platform,
                    channel: notification.channelName,
                  },
                });
              },
            },
          });
        }
      }
    );
    const unsubscribeOpen = window.electronAPI?.notifications?.onOpenLiveNotification?.(
      (notification) => {
        void router.navigate({
          to: "/stream/$platform/$channel",
          params: {
            platform: notification.platform,
            channel: notification.channelName,
          },
        });
      }
    );

    return () => {
      unsubscribeLive?.();
      unsubscribeOpen?.();
    };
  }, []);
}
