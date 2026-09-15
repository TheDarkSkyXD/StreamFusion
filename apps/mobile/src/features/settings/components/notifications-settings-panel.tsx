import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { LiveNotificationRestartGraceMinutes } from "@streamfusion/core/follows";

import {
  mobileColors,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import {
  SettingsChoiceRow,
  SettingsCopy,
  SettingsSection,
  SettingsSwitch,
} from "./settings-controls";
import type {
  NotificationPreferencePatch,
  NotificationSettingsSession,
  NotificationSettingsView,
} from "../capabilities/notification-settings";
import { defaultNotificationSettingsView } from "../domain/notification-status";

const GRACE_OPTIONS: readonly LiveNotificationRestartGraceMinutes[] = [
  0, 5, 15, 30,
];

const NOTIFICATION_TOGGLES = [
  { field: "enabled", label: "Android notifications", testID: "android-notifications" },
  { field: "liveAlerts", label: "Live Notification history", testID: "live-activity" },
  { field: "toastAlerts", label: "In-app banners", testID: "toast" },
  { field: "sound", label: "Sound", testID: "sound" },
  { field: "twitch", label: "Twitch", testID: "notify-twitch" },
  { field: "kick", label: "Kick", testID: "notify-kick" },
  { field: "guestFollows", label: "Guest Follow notifications", testID: "notify-guest" },
  { field: "favoriteChannelsOnly", label: "Favorites only", testID: "favorites-only" },
] as const;

function togglePatch(
  field: (typeof NOTIFICATION_TOGGLES)[number]["field"],
  on: boolean,
): NotificationPreferencePatch {
  return { [field]: on };
}

function NotificationRecovery({
  denied,
  onOpenSettings,
  onRetry,
}: {
  readonly denied: boolean;
  readonly onOpenSettings: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <View style={styles.recovery}>
      {denied ? (
        <Pressable
          accessibilityLabel="Retry notification permission"
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.action}
          testID="notifications-retry"
        >
          <Text selectable style={styles.actionLabel}>
            Retry permission
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Open system notification settings"
        accessibilityRole="button"
        onPress={onOpenSettings}
        style={styles.action}
        testID="notifications-system-settings"
      >
        <Text selectable style={styles.actionLabel}>
          Open system notification settings
        </Text>
      </Pressable>
    </View>
  );
}

export function NotificationsSettingsPanel({
  session,
}: {
  readonly session: NotificationSettingsSession;
}) {
  const [view, setView] = useState<NotificationSettingsView>(
    defaultNotificationSettingsView,
  );
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setView(session.peek());
    });
    void session.load().then(setView);
    return unsubscribe;
  }, [session]);
  return (
    <NotificationsSettingsView
      onChange={(patch) => {
        void session.apply(patch).then(setView);
      }}
      onOpenSettings={() => {
        void session.openSystemSettings();
      }}
      onRetry={() => {
        void session.retryPermission().then(setView);
      }}
      view={view}
    />
  );
}

export function NotificationsSettingsView({
  onChange,
  onOpenSettings,
  onRetry,
  view,
}: {
  readonly onChange: (patch: NotificationPreferencePatch) => void;
  readonly onOpenSettings: () => void;
  readonly onRetry: () => void;
  readonly view: NotificationSettingsView;
}) {
  const prefs = view.preferences;
  return (
    <SettingsSection testID="panel-notifications" title="NOTIFICATIONS">
      <SettingsCopy testID="notifications-permission" value={view.permissionCopy} />
      <SettingsCopy testID="notifications-delivery" value={view.deliveryCopy} />
      {NOTIFICATION_TOGGLES.map((toggle) => (
        <SettingsSwitch
          checked={prefs[toggle.field]}
          key={toggle.testID}
          label={toggle.label}
          onToggle={() => onChange(togglePatch(toggle.field, !prefs[toggle.field]))}
          testID={toggle.testID}
        />
      ))}
      <SettingsCopy
        testID="favorites-only-effective"
        value="Favorites only uses per-channel switches on Following."
      />
      <SettingsChoiceRow
        current={prefs.restartGracePeriodMinutes}
        label="Restart grace minutes"
        onSelect={(restartGracePeriodMinutes) =>
          onChange({ restartGracePeriodMinutes })
        }
        options={GRACE_OPTIONS}
        testID="restart-grace"
      />
      <NotificationRecovery
        denied={view.denied}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  recovery: {
    gap: mobileSpacing.small,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
