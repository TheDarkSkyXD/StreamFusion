import type { ActivityItem } from "@streamfusion/core/activity";
import type { InstallationCredentialStore } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";
import type { NotificationPermissionPort } from "@mobile/features/settings/capabilities/notification-settings";

import { createHttpNativePushTransport } from "../adapters/http-native-push-transport";
import {
  createExpoLocalNotificationPresenter,
  createExpoNotificationChannels,
  createExpoNotificationReceiptSource,
  createExpoPushTokenSource,
} from "../adapters/expo-notification-runtime";
import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";

export function createNativeNotificationRuntimeForApp(input: {
  readonly activityRepository: ActivityRepository;
  readonly fetch?: typeof fetch;
  readonly followingSession: FollowingSession;
  readonly identityStore: InstallationCredentialStore;
  readonly permission: NotificationPermissionPort;
  readonly relayBaseUrl: string;
}) {
  return createNativeNotificationRuntime({
    activity: {
      async record(item: ActivityItem) {
        await input.activityRepository.record(item);
      },
    },
    channels: createExpoNotificationChannels(),
    follows: input.followingSession,
    identityReady: async () => (await readCredential(input.identityStore)) !== null,
    permission: async () => {
      const status = (await input.permission.read()).permission;
      return status === "not-requested" ? "unavailable" : status;
    },
    presenter: createExpoLocalNotificationPresenter(),
    receipts: createExpoNotificationReceiptSource(),
    tokens: createExpoPushTokenSource(),
    transport: createHttpNativePushTransport({
      baseUrl: input.relayBaseUrl,
      credential: () => readCredential(input.identityStore),
      fetch: input.fetch ?? globalThis.fetch,
    }),
  });
}

async function readCredential(
  store: InstallationCredentialStore,
): Promise<string | null> {
  const read = await store.read();
  if (read.kind !== "ready" || read.state.credential === null) return null;
  return read.state.credential.credential;
}
