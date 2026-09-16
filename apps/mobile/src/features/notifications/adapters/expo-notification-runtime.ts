import {
  safeNotificationPayloadSchema,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type {
  LocalNotificationPresenter,
  NativeNotificationChannels,
  NativePushTokenSource,
  NotificationReceiptSource,
} from "../capabilities/native-notifications";

const CHANNELS = [
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function createExpoNotificationChannels(): NativeNotificationChannels {
  return {
    async ensure() {
      if (Platform.OS !== "android") return;
      for (const channel of CHANNELS) {
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
      try {
        if (Constants.appOwnership === "expo") return null;
        return nativeTokenData(
          (await Notifications.getDevicePushTokenAsync()).data,
        );
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      const subscription = Notifications.addPushTokenListener((event) => {
        const token = nativeTokenData(event.data);
        if (token) listener(token);
      });
      return () => subscription.remove();
    },
  };
}

export function createExpoNotificationReceiptSource(): NotificationReceiptSource {
  return {
    async initial() {
      const response = await Notifications.getLastNotificationResponseAsync();
      return payloadFromData(response?.notification.request.content.data);
    },
    subscribe(listener) {
      const received = Notifications.addNotificationReceivedListener(
        (notification) => {
          const payload = payloadFromData(notification.request.content.data);
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
      return () => {
        received.remove();
        response.remove();
      };
    },
  };
}

export function createExpoLocalNotificationPresenter(): LocalNotificationPresenter {
  return {
    async present(payload) {
      const channelId = payload.channel ?? "live";
      await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.title,
          body: payload.body,
          data: payload,
          sound: true,
          color: "#0f0f0f",
        },
        trigger: { channelId },
      });
    },
  };
}

function nativeTokenData(value: unknown): string | null {
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function payloadFromData(data: unknown): SafeNotificationPayload | null {
  return safeNotificationPayloadSchema.is(data) ? data : null;
}
