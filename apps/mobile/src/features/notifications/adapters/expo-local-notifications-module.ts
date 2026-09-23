/**
 * Expo Go on Android (SDK 53+) throws if the `expo-notifications` package root
 * is imported: `DevicePushTokenAutoRegistration.fx` calls `addPushTokenListener`,
 * and `warnOfExpoGoPushUsage` throws there.
 *
 * Local presentation, channels, permissions, and receipt listeners do not need
 * that side effect. Load those APIs via deep imports so Expo Go can still show
 * guest live alerts. Remote push token APIs stay on the package root and are
 * only loaded outside Expo Go.
 */

import { isRunningInExpoGo } from "expo";

export type ExpoLocalNotificationsModule = {
  readonly AndroidImportance: {
    readonly DEFAULT: number;
    readonly MAX: number;
  };
  readonly addNotificationReceivedListener: (listener: (notification: {
    readonly request: { readonly content: { readonly data: unknown } };
  }) => void) => { remove(): void };
  readonly addNotificationResponseReceivedListener: (listener: (event: {
    readonly notification: {
      readonly request: { readonly content: { readonly data: unknown } };
    };
  }) => void) => { remove(): void };
  readonly getLastNotificationResponseAsync: () => Promise<{
    readonly notification: {
      readonly request: { readonly content: { readonly data: unknown } };
    };
  } | null>;
  readonly getPermissionsAsync: () => Promise<{ readonly status: string }>;
  readonly requestPermissionsAsync: () => Promise<{ readonly status: string }>;
  readonly scheduleNotificationAsync: (request: {
    readonly content: {
      readonly title: string;
      readonly body: string;
      readonly data?: Record<string, unknown>;
      readonly sound?: boolean;
      readonly color?: string;
      readonly channelId?: string;
    };
    readonly trigger: null;
  }) => Promise<string>;
  readonly setNotificationChannelAsync: (
    id: string,
    channel: {
      readonly name: string;
      readonly importance: number;
      readonly lightColor?: string;
    },
  ) => Promise<unknown>;
  readonly setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
      shouldShowBanner: boolean;
      shouldShowList: boolean;
    }>;
  }) => void;
};

export type ExpoRemotePushModule = {
  readonly addPushTokenListener: (listener: (event: {
    readonly data: unknown;
  }) => void) => { remove(): void };
  readonly getDevicePushTokenAsync: () => Promise<{ readonly data: unknown }>;
};

let localModulePromise: Promise<ExpoLocalNotificationsModule | null> | undefined;
let remoteModulePromise: Promise<ExpoRemotePushModule | null> | undefined;

export function isExpoGoHost(): boolean {
  return isRunningInExpoGo();
}

export async function loadExpoLocalNotifications(): Promise<ExpoLocalNotificationsModule | null> {
  if (!localModulePromise) {
    localModulePromise = importLocalModule().catch(() => null);
  }
  return localModulePromise;
}

export async function loadExpoRemotePush(): Promise<ExpoRemotePushModule | null> {
  // Package-root import evaluates DevicePushTokenAutoRegistration.fx, which
  // throws on Android Expo Go. Never load it there.
  if (isRunningInExpoGo()) return null;
  if (!remoteModulePromise) {
    remoteModulePromise = import("expo-notifications")
      .then((mod) => mod as unknown as ExpoRemotePushModule)
      .catch(() => null);
  }
  return remoteModulePromise;
}

async function importLocalModule(): Promise<ExpoLocalNotificationsModule> {
  const [
    channels,
    channelTypes,
    permissions,
    scheduler,
    emitter,
    handler,
  ] = await Promise.all([
    import("expo-notifications/build/setNotificationChannelAsync.js"),
    import("expo-notifications/build/NotificationChannelManager.types.js"),
    import("expo-notifications/build/NotificationPermissions.js"),
    import("expo-notifications/build/scheduleNotificationAsync.js"),
    import("expo-notifications/build/NotificationsEmitter.js"),
    import("expo-notifications/build/NotificationsHandler.js"),
  ]);

  return {
    AndroidImportance: channelTypes.AndroidImportance,
    addNotificationReceivedListener: emitter.addNotificationReceivedListener,
    addNotificationResponseReceivedListener:
      emitter.addNotificationResponseReceivedListener,
    getLastNotificationResponseAsync: emitter.getLastNotificationResponseAsync,
    getPermissionsAsync: permissions.getPermissionsAsync,
    requestPermissionsAsync: permissions.requestPermissionsAsync,
    scheduleNotificationAsync: scheduler.scheduleNotificationAsync,
    setNotificationChannelAsync: channels.setNotificationChannelAsync,
    setNotificationHandler: handler.setNotificationHandler,
  } as ExpoLocalNotificationsModule;
}
