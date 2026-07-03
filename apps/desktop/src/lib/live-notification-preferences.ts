import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type FollowSource,
  type NotificationPreferences,
  type Platform,
} from "@/shared/auth-types";

export type NotificationChannel = {
  platform: Platform;
  id?: string;
  username?: string;
};

export function liveNotificationChannelKey(channel: NotificationChannel): string {
  return `${channel.platform}:${channel.id || channel.username?.toLowerCase() || ""}`;
}

export function isPerChannelNotificationEnabled(
  preferences: NotificationPreferences,
  channel: NotificationChannel
): boolean {
  return preferences.perChannelNotifications[liveNotificationChannelKey(channel)] ?? true;
}

export function getNotificationPreferences(
  preferences?: Partial<NotificationPreferences> | null
): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(preferences ?? {}),
    perChannelNotifications: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.perChannelNotifications,
      ...(preferences?.perChannelNotifications ?? {}),
    },
  };
}

export function isChannelEligibleForLiveNotification(args: {
  preferences?: Partial<NotificationPreferences> | null;
  channel: NotificationChannel;
  followSource?: FollowSource | null;
}): boolean {
  const preferences = getNotificationPreferences(args.preferences);
  if (!preferences.liveAlerts) return false;
  if (args.channel.platform === "twitch" && !preferences.twitch) return false;
  if (args.channel.platform === "kick" && !preferences.kick) return false;
  if (args.followSource === "guest" && !preferences.guestFollows) return false;

  return (
    !preferences.favoriteChannelsOnly || isPerChannelNotificationEnabled(preferences, args.channel)
  );
}

export function setPerChannelNotificationPreference(
  preferences: NotificationPreferences,
  channel: NotificationChannel,
  enabled: boolean
): NotificationPreferences {
  return {
    ...preferences,
    perChannelNotifications: {
      ...preferences.perChannelNotifications,
      [liveNotificationChannelKey(channel)]: enabled,
    },
  };
}

export function platformNotificationField(platform: Platform): "twitch" | "kick" {
  return platform === "twitch" ? "twitch" : "kick";
}
