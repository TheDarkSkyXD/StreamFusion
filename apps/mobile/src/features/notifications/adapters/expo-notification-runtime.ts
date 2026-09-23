import {
  safeNotificationPayloadSchema,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";
import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";

import type {
  LocalNotificationPresenter,
  NativeNotificationChannels,
  NativePushTokenSource,
  NotificationReceiptSource,
} from "../capabilities/native-notifications";

/**
 * Never statically import `expo-notifications` on Android Expo Go: its
 * DevicePushTokenAutoRegistration side effect calls addPushTokenListener,
 * which throws (SDK 53+). Stubs keep the app bootable; local push is skipped.
 */
const expoGo = isRunningInExpoGo();

type NotificationsModule = typeof import("expo-notifications");

let notificationsModulePromise: Promise<NotificationsModule | null> | undefined;

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (expoGo) return null;
  if (!notificationsModulePromise) {
    notificationsModulePromise = import("expo-notifications")
      .then((mod) => mod)
      .catch(() => null);
  }
  return notificationsModulePromise;
}

export function createExpoNotificationChannels(): NativeNotificationChannels {
  return {
    async ensure() {
      if (expoGo || Platform.OS !== "android") return;
      const Notifications = await loadNotifications();
      if (!Notifications) return;
      const channels = [
        {
          id: "live",
          name: "Live alerts",
          importance: Notifications.AndroidImportance.MAX,
        },
        {
          id: "media",
          name: "Downloads and recordings",
          importance: Notifications.AndroidImportance.DEFAULT,
        },
        {
          id: "account-device",
          name: "Account and device",
          importance: Notifications.AndroidImportance.DEFAULT,
        },
      ] as const;
      for (const channel of channels) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: channel.importance,
          lightColor: "#0f0f0f",
        });
      }
    },
  };
}

export function createExpoPushTokenSource(): NativePushTokenSource {
  return {
    async read() {
      if (expoGo) return null;
      const Notifications = await loadNotifications();
      if (!Notifications) return null;
      try {
        return nativeTokenData(
          (await Notifications.getDevicePushTokenAsync()).data,
        );
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      if (expoGo) return () => undefined;
      let remove = () => undefined;
      void loadNotifications().then((Notifications) => {
        if (!Notifications) return;
        try {
          const subscription = Notifications.addPushTokenListener((event) => {
            const token = nativeTokenData(event.data);
            if (token) listener(token);
          });
          remove = () => subscription.remove();
        } catch {
          remove = () => undefined;
        }
      });
      return () => remove();
    },
  };
}

export function createExpoNotificationReceiptSource(): NotificationReceiptSource {
  return {
    async initial() {
      if (expoGo) return null;
      const Notifications = await loadNotifications();
      if (!Notifications) return null;
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        return payloadFromData(response?.notification.request.content.data);
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      if (expoGo) return () => undefined;
      let remove = () => undefined;
      void loadNotifications().then((Notifications) => {
        if (!Notifications) return;
        try {
          Notifications.setNotificationHandler({
            handleNotification: async () => ({
              shouldPlaySound: true,
              shouldSetBadge: false,
              shouldShowBanner: true,
              shouldShowList: true,
            }),
          });
          const received = Notifications.addNotificationReceivedListener(
            (notification) => {
              const payload = payloadFromData(
                notification.request.content.data,
              );
              if (payload) listener({ foreground: true, payload });
            },
          );
          const response = Notifications.addNotificationResponseReceivedListener(
            (event) => {
              const payload = payloadFromData(
                event.notification.request.content.data,
              );
              if (payload) listener({ foreground: false, payload });
            },
          );
          remove = () => {
            received.remove();
            response.remove();
          };
        } catch {
          remove = () => undefined;
        }
      });
      return () => remove();
    },
  };
}

export function createExpoLocalNotificationPresenter(): LocalNotificationPresenter {
  return {
    async present(payload, options) {
      if (expoGo) return;
      const Notifications = await loadNotifications();
      if (!Notifications) return;
      const channelId = payload.channel ?? "live";
      const silent = options?.silent === true;
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: payload.title,
            body: payload.body,
            data: payload,
            sound: silent ? false : true,
            color: "#0f0f0f",
            ...(Platform.OS === "android" ? { channelId } : {}),
          },
          trigger: null,
        });
      } catch {
        // Expo Go / permission edges must not crash Settings or proof controls.
      }
    },
  };
}

function nativeTokenData(value: unknown): string | null {
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function payloadFromData(data: unknown): SafeNotificationPayload | null {
  return safeNotificationPayloadSchema.is(data) ? data : null;
}
