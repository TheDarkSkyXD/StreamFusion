import type { ActivityItem } from "@streamfusion/core/activity";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import { createAndroidBackgroundLiveAlerts } from "../adapters/android-background-live-alerts";
import {
  createAndroidLocalNotificationPresenter,
  createAndroidNotificationPolicy,
  createAndroidNotificationChannels,
  createAndroidNotificationReceiptSource,
} from "../adapters/android-notification-runtime";
import { createNativeNotificationRuntime } from "../domain/native-notification-runtime";

export function createNativeNotificationRuntimeForApp(input: {
  readonly activityRepository: ActivityRepository;
  readonly followingSession: FollowingSession;
}) {
  return createNativeNotificationRuntime({
    activity: {
      async record(item: ActivityItem) {
        await input.activityRepository.record(item);
      },
    },
    background: createAndroidBackgroundLiveAlerts(),
    channels: createAndroidNotificationChannels(),
    follows: input.followingSession,
    postingPolicy: createAndroidNotificationPolicy(),
    presenter: createAndroidLocalNotificationPresenter(),
    receipts: createAndroidNotificationReceiptSource(),
  });
}
