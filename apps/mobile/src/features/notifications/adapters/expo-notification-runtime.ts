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
  type ExpoLocalNotificationsModule,
} from "./expo-local-notifications-module";

/**
 * Local live alerts work in Expo Go via the static local-notifications shim
 * (extensionless build subpaths — not dynamic build/*.js imports).
 * Android notification channels are skipped / soft-failed in Expo Go (null
 * NotificationsChannelsProvider); scheduleNotificationAsync still presents on
 * the default channel. Remote FCM / device push token registration stays
 * disabled in Expo Go — the package-root import pulls ExpoPushTokenManager /
 * auto-registration that break Android Expo Go SDK 53+.
 *
 * Guest go-live only polls while AppState is active, so every production
 * present() is a foreground present. Expo discards shade notifications unless
 * setNotificationHandler is installed first — do that in present() itself, not
 * only inside the async receipts subscribe().
 */

/** Built-in Expo Android channel when custom channels are unavailable (Expo Go). */
const EXPO_GO_FALLBACK_CHANNEL_ID =
  "expo_notifications_fallback_notification_channel";

// Banner + list map to shouldPresentAlert on current Expo Go bridges and keep
// the tray. Do not set deprecated shouldShowAlert (client warning).
const FOREGROUND_PRESENTATION = {
  shouldPlaySound: true,
  shouldSetBadge: false,
  shouldShowBanner: true,
  shouldShowList: true,
} as const;

let foregroundHandlerInstalled = false;

function ensureForegroundPresentationHandler(
  Notifications: ExpoLocalNotificationsModule,
): void {
  if (foregroundHandlerInstalled) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ ...FOREGROUND_PRESENTATION }),
  });
  foregroundHandlerInstalled = true;
}

async function ensureNotificationPermission(
  Notifications: ExpoLocalNotificationsModule,
): Promise<boolean> {
  // Android 12L and below do not use POST_NOTIFICATIONS; Expo may still
  // report undetermined. Never block tray presentation on those API levels.
  if (Platform.OS === "android" && Number(Platform.Version) < 33) return true;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === "granted") return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === "granted";
  } catch {
    return false;
  }
}

export function createExpoNotificationChannels(): NativeNotificationChannels {
  return {
    async ensure() {
      if (Platform.OS !== "android") return;
      // Expo Go Android: ExpoNotificationChannelManager has a null
      // NotificationsChannelsProvider, so setNotificationChannelAsync NPEs.
      // Skip custom channels; guest live alerts still present on the default
      // channel via scheduleNotificationAsync.
      if (isExpoGoHost()) return;
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
      try {
        for (const channel of channels) {
          await Notifications.setNotificationChannelAsync(channel.id, {
            name: channel.name,
            importance: channel.importance,
            lightColor: "#0f0f0f",
          });
        }
      } catch {
        // Soft-fail: boot / presentProof must not surface uncaught channel NPEs.
        // Local schedule still works without custom channels (default channel).
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
          ensureForegroundPresentationHandler(Notifications);
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
      // Go-live only: never schedule end-of-stream watch alerts into the tray.
      if (
        payload.destination.kind === "watch-channel" &&
        payload.destination.streamState !== "live"
      ) {
        return;
      }
      ensureForegroundPresentationHandler(Notifications);
      const allowed = await ensureNotificationPermission(Notifications);
      if (!allowed) return;
      const channelId = payload.channel ?? "live";
      const silent = options?.silent === true;
      // Expo Go cannot create custom Android channels (provider NPE). Use the
      // built-in fallback channel via a channel-aware trigger so native code
      // does not log "Couldn't get channel - trigger is null".
      const expoGoAndroid = Platform.OS === "android" && isExpoGoHost();
      const attachCustomAndroidChannel =
        Platform.OS === "android" && !isExpoGoHost();
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: payload.title,
            body: payload.body,
            data: payload,
            sound: silent ? false : true,
            color: "#0f0f0f",
            ...(attachCustomAndroidChannel ? { channelId } : {}),
            ...(expoGoAndroid
              ? { channelId: EXPO_GO_FALLBACK_CHANNEL_ID }
              : {}),
            ...(Platform.OS === "android" ? { priority: "max" } : {}),
          },
          trigger: expoGoAndroid
            ? { channelId: EXPO_GO_FALLBACK_CHANNEL_ID }
            : null,
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