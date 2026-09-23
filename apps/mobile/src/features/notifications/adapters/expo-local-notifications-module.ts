/**
 * Expo Go on Android (SDK 53+) throws if the `expo-notifications` package root
 * is imported: `DevicePushTokenAutoRegistration.fx` / `TokenEmitter` pull
 * `ExpoPushTokenManager` and Expo Go push guards.
 *
 * Local presentation, channels, permissions, and receipt listeners do not need
 * that path. Load them via `./expo-local-notifications-api` (static deep imports
 * without `.js`), which Metro resolves into the app graph. Avoid
 * `import("expo-notifications/build/*.js")` — those dynamic package deep imports
 * redbox with "Requiring unknown module" in Expo Go.
 *
 * Guest go-live alerts (follow → poller → reconciler → present) depend on this
 * loader succeeding in Expo Go. Remote push token APIs stay on the package root
 * and are only loaded outside Expo Go.
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
  // Package-root import evaluates DevicePushTokenAutoRegistration.fx / TokenEmitter,
  // which are unsafe on Android Expo Go. Never load it there.
  if (isRunningInExpoGo()) return null;
  if (!remoteModulePromise) {
    remoteModulePromise = import("expo-notifications")
      .then((mod) => mod as unknown as ExpoRemotePushModule)
      .catch(() => null);
  }
  return remoteModulePromise;
}

async function importLocalModule(): Promise<ExpoLocalNotificationsModule> {
  // Relative import of our shim — Metro-stable. The shim statically pulls
  // extensionless build subpaths (schedule, channels, permissions, emitters).
  const api = await import("./expo-local-notifications-api");
  return {
    AndroidImportance: api.AndroidImportance,
    addNotificationReceivedListener: api.addNotificationReceivedListener,
    addNotificationResponseReceivedListener:
      api.addNotificationResponseReceivedListener,
    getLastNotificationResponseAsync: api.getLastNotificationResponseAsync,
    getPermissionsAsync: api.getPermissionsAsync,
    requestPermissionsAsync: api.requestPermissionsAsync,
    scheduleNotificationAsync: api.scheduleNotificationAsync,
    setNotificationChannelAsync: api.setNotificationChannelAsync,
    setNotificationHandler: api.setNotificationHandler,
  } as ExpoLocalNotificationsModule;
}
