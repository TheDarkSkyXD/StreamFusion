import {
  safeNotificationPayloadSchema,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";
import { Platform } from "react-native";

import type {
  LocalNotificationPresenter,
  NativeNotificationChannels,
  NativePushTokenSource,
  NotificationReceiptSource,
} from "../capabilities/native-notifications";
import {
  isExpoGoHost,
  loadExpoLocalNotifications,
  loadExpoRemotePush,
} from "./expo-local-notifications-module";

/**
 * Local live alerts work in Expo Go via the static local-notifications shim
 * (extensionless build subpaths — not dynamic `build/*.js` imports).
 * Remote FCM / device push token registration stays disabled in Expo Go — the
 * package-root import pulls ExpoPushTokenManager / auto-registration that
 * break Android Expo Go SDK 53+.
 */

export function createExpoNotificationChannels(): NativeNotificationChannels {
  return {
    async ensure() {
      if (Platform.OS !== "android") return;
      const Notifications = await loadExpoLocalNotifications();
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
      if (isExpoGoHost()) return null;
      const Notifications = await loadExpoRemotePush();
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
      if (isExpoGoHost()) return () => undefined;
      let remove = () => undefined;
      void loadExpoRemotePush().then((Notifications) => {
        if (!Notifications) return;
        try {
          const subscription = Notifications.addPushTokenListener((event) => {
            const token = nativeTokenData(event.data);
            if (token) listener(token);
          });
          remove = () => {
            subscription.remove();
          };
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
      const Notifications = await loadExpoLocalNotifications();
      if (!Notifications) return null;
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        return payloadFromData(response?.notification.request.content.data);
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      let remove = () => undefined;
      void loadExpoLocalNotifications().then((Notifications) => {
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
      const Notifications = await loadExpoLocalNotifications();
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
