import type { FollowSourceFor } from "./follow-policy.ts";

export type LiveNotificationRestartGraceMinutes = 0 | 5 | 15 | 30;

export type LiveNotificationPreferences = {
  readonly doNotDisturb: boolean;
  readonly enabled: boolean;
  readonly liveAlerts: boolean;
  readonly twitch: boolean;
  readonly kick: boolean;
  readonly guestFollows: boolean;
  readonly toastAlerts: boolean;
  readonly sound: boolean;
  readonly favoriteChannelsOnly: boolean;
  readonly restartGracePeriodMinutes: LiveNotificationRestartGraceMinutes;
  readonly perChannelNotifications: Readonly<Record<string, boolean>>;
};

export const DEFAULT_LIVE_NOTIFICATION_PREFERENCES: LiveNotificationPreferences =
  {
    doNotDisturb: false,
    enabled: true,
    liveAlerts: true,
    twitch: true,
    kick: true,
    guestFollows: true,
    toastAlerts: true,
    sound: true,
    favoriteChannelsOnly: false,
    restartGracePeriodMinutes: 0,
    perChannelNotifications: {},
  };

export type LiveNotificationChannel<TPlatform extends string> = {
  readonly platform: TPlatform;
  readonly id?: string;
  readonly username?: string;
};

export function liveNotificationChannelKey<TPlatform extends string>(
  channel: LiveNotificationChannel<TPlatform>,
): string {
  return `${channel.platform}:${channel.id || channel.username?.toLowerCase() || ""}`;
}

export function getLiveNotificationPreferences(
  preferences?: Partial<LiveNotificationPreferences> | null,
): LiveNotificationPreferences {
  return {
    ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    ...(preferences ?? {}),
    perChannelNotifications: {
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES.perChannelNotifications,
      ...(preferences?.perChannelNotifications ?? {}),
    },
  };
}

export function isPerChannelLiveNotificationEnabled<TPlatform extends string>(
  preferences: LiveNotificationPreferences,
  channel: LiveNotificationChannel<TPlatform>,
): boolean {
  return (
    preferences.perChannelNotifications[liveNotificationChannelKey(channel)] ??
    true
  );
}

export function setPerChannelLiveNotificationPreference<
  TPlatform extends string,
>(
  preferences: LiveNotificationPreferences,
  channel: LiveNotificationChannel<TPlatform>,
  enabled: boolean,
): LiveNotificationPreferences {
  return {
    ...preferences,
    perChannelNotifications: {
      ...preferences.perChannelNotifications,
      [liveNotificationChannelKey(channel)]: enabled,
    },
  };
}

export function isFollowEligibleForLiveNotification<
  TPlatform extends string,
>(options: {
  readonly preferences?: Partial<LiveNotificationPreferences> | null;
  readonly channel: LiveNotificationChannel<TPlatform>;
  readonly followSource?: FollowSourceFor<TPlatform> | null;
}): boolean {
  const preferences = getLiveNotificationPreferences(options.preferences);
  if (!preferences.liveAlerts) return false;
  if (options.channel.platform === "twitch" && !preferences.twitch) {
    return false;
  }
  if (options.channel.platform === "kick" && !preferences.kick) return false;
  if (options.followSource === "guest" && !preferences.guestFollows) {
    return false;
  }

  return (
    !preferences.favoriteChannelsOnly ||
    isPerChannelLiveNotificationEnabled(preferences, options.channel)
  );
}

export type LiveAlertSurfaces = {
  readonly toast: boolean;
  readonly systemNotification: { readonly silent: boolean } | null;
};

// Do Not Disturb is a mute that overrides the interruption flags, not a
// follow filter: it silences every surface while history keeps recording.
export function resolveLiveAlertSurfaces(
  preferences: LiveNotificationPreferences,
  systemNotificationsSupported = false,
): LiveAlertSurfaces {
  if (preferences.doNotDisturb) {
    return { toast: false, systemNotification: null };
  }

  return {
    toast: preferences.toastAlerts,
    systemNotification:
      preferences.enabled && systemNotificationsSupported
        ? { silent: !preferences.sound }
        : null,
  };
}

export type LiveNotificationDecision =
  | {
      readonly kind: "deliver";
      readonly inApp: true;
      readonly systemNotification: { readonly silent: boolean } | null;
    }
  | {
      readonly kind: "ignore";
      readonly reason:
        "silent-sync" | "already-live" | "ineligible-follow" | "restart-grace";
    };

export function resolveLiveNotificationDecision(options: {
  readonly preferences: LiveNotificationPreferences;
  readonly silentSync: boolean;
  readonly wasLive: boolean;
  readonly eligible: boolean;
  readonly systemNotificationsSupported: boolean;
  readonly nowMs: number;
  readonly lastNotifiedAtMs?: number;
}): LiveNotificationDecision {
  if (options.silentSync) return { kind: "ignore", reason: "silent-sync" };
  if (options.wasLive) return { kind: "ignore", reason: "already-live" };
  if (!options.eligible || !options.preferences.liveAlerts) {
    return { kind: "ignore", reason: "ineligible-follow" };
  }

  const graceMs = options.preferences.restartGracePeriodMinutes * 60_000;
  if (
    graceMs > 0 &&
    options.lastNotifiedAtMs !== undefined &&
    options.nowMs - options.lastNotifiedAtMs < graceMs
  ) {
    return { kind: "ignore", reason: "restart-grace" };
  }

  return {
    kind: "deliver",
    inApp: true,
    systemNotification: resolveLiveAlertSurfaces(
      options.preferences,
      options.systemNotificationsSupported,
    ).systemNotification,
  };
}
