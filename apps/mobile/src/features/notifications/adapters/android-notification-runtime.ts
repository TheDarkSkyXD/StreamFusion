import {
  safeNotificationPayloadSchema,
  type SafeNotificationPayload,
} from "@streamfusion/core/relay";
import { Platform } from "react-native";

import type {
  LocalNotificationPresenter,
  NativeNotificationChannels,
  NativeNotificationPolicy,
  NativePushTokenSource,
  NotificationReceiptSource,
} from "../capabilities/native-notifications";
import {
  createNotificationEvents,
  getNativeNotifications,
} from "./android-notifications-module";

export function createAndroidNotificationPolicy(): NativeNotificationPolicy {
  return {
    async apply({ enabled, sound }) {
      await getNativeNotifications().configureLiveAlerts(enabled, sound);
    },
  };
}

export function createAndroidNotificationChannels(): NativeNotificationChannels {
  return {
    async ensure() {
      if (Platform.OS === "android") await getNativeNotifications().ensureChannels();
    },
  };
}

export function createAndroidPushTokenSource(): NativePushTokenSource {
  return {
    async read() {
      try {
        return nativeTokenData(await getNativeNotifications().getDevicePushToken());
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      const subscription = createNotificationEvents().addListener("pushToken", (event: unknown) => {
        if (!isRecord(event)) return;
        const token = nativeTokenData(event.token);
        if (token) listener(token);
      });
      return () => subscription.remove();
    },
  };
}

export function createAndroidNotificationReceiptSource(): NotificationReceiptSource {
  return {
    async initial() {
      try {
        return payloadFromJson(await getNativeNotifications().getInitialResponse());
      } catch {
        return null;
      }
    },
    subscribe(listener) {
      const events = createNotificationEvents();
      const received = events.addListener("notificationReceived", (event: unknown) => {
        const payload = payloadFromEvent(event);
        if (payload) listener({ foreground: true, payload });
      });
      const opened = events.addListener("notificationOpened", (event: unknown) => {
        const payload = payloadFromEvent(event);
        if (payload) listener({ foreground: false, payload });
      });
      return () => {
        received.remove();
        opened.remove();
      };
    },
  };
}

export function createAndroidLocalNotificationPresenter(): LocalNotificationPresenter {
  return {
    async present(payload, options) {
      if (
        payload.destination.kind === "watch-channel" &&
        payload.destination.streamState !== "live"
      ) return;
      try {
        const notifications = getNativeNotifications();
        const allowed = Number(Platform.Version) < 33
          ? true
          : (await notifications.getPermissionStatus()) === "granted" ||
            (await notifications.requestPermission()) === "granted";
        if (!allowed) return;
        await notifications.present(
          payload.title,
          payload.body,
          JSON.stringify(payload),
          payload.channel ?? "live",
          options?.silent === true,
        );
      } catch {
        return;
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeTokenData(value: unknown): string | null {
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function payloadFromEvent(event: unknown): SafeNotificationPayload | null {
  return isRecord(event) ? payloadFromJson(event.payloadJson) : null;
}

function payloadFromJson(value: unknown): SafeNotificationPayload | null {
  if (typeof value !== "string") return null;
  try {
    const data: unknown = JSON.parse(value);
    return safeNotificationPayloadSchema.is(data) ? data : null;
  } catch {
    return null;
  }
}
