import {
  getLiveNotificationPreferences,
  isFollowEligibleForLiveNotification,
  isPerChannelLiveNotificationEnabled,
  liveNotificationChannelKey as coreLiveNotificationChannelKey,
  setPerChannelLiveNotificationPreference,
  type LiveNotificationChannel,
} from "@streamfusion/core/follows";
import { type FollowSource, type NotificationPreferences, type Platform } from "@shared/auth-types";

export type NotificationChannel = LiveNotificationChannel<Platform>;

export function liveNotificationChannelKey(channel: NotificationChannel): string {
  return coreLiveNotificationChannelKey(channel);
}

export function isPerChannelNotificationEnabled(
  preferences: NotificationPreferences,
  channel: NotificationChannel
): boolean {
  return isPerChannelLiveNotificationEnabled(preferences, channel);
}

export function getNotificationPreferences(
  preferences?: Partial<NotificationPreferences> | null
): NotificationPreferences {
  return getLiveNotificationPreferences(preferences);
}

export function isChannelEligibleForLiveNotification(args: {
  preferences?: Partial<NotificationPreferences> | null;
  channel: NotificationChannel;
  followSource?: FollowSource | null;
}): boolean {
  return isFollowEligibleForLiveNotification(args);
}

export function setPerChannelNotificationPreference(
  preferences: NotificationPreferences,
  channel: NotificationChannel,
  enabled: boolean
): NotificationPreferences {
  return setPerChannelLiveNotificationPreference(preferences, channel, enabled);
}
