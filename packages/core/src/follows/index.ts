import type { Platform } from "../platform/index.ts";
import type { FollowSourceFor } from "../use-cases/follow-policy.ts";

export type {
  AccountFollowReader,
  AccountFollowReadOptions,
  AccountFollowReadResult,
  FollowedChannelReader,
  FollowedStreamReader,
} from "../capabilities/follows.ts";
export {
  planAccountFollowSync,
  resolveFollowMutation,
  selectActiveFollowCollection,
} from "../use-cases/follow-policy.ts";
export {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  getLiveNotificationPreferences,
  isFollowEligibleForLiveNotification,
  isPerChannelLiveNotificationEnabled,
  liveNotificationChannelKey,
  resolveLiveNotificationDecision,
  setPerChannelLiveNotificationPreference,
} from "../use-cases/live-notification-policy.ts";
export type {
  LiveNotificationChannel,
  LiveNotificationDecision,
  LiveNotificationPreferences,
  LiveNotificationRestartGraceMinutes,
} from "../use-cases/live-notification-policy.ts";
export type {
  AccountFollowSyncPlan,
  ActiveFollowCollection,
  FollowMutation,
  FollowSourceFor,
} from "../use-cases/follow-policy.ts";

export type FollowSource = FollowSourceFor<Platform>;
