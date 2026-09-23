import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  setPerChannelLiveNotificationPreference,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import { MobileButton } from "@mobile/design/button";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  NotificationPermissionPort,
  NotificationPermissionStatus,
} from "@mobile/features/settings/capabilities/notification-settings";
import { SettingsSwitch } from "@mobile/features/settings/components/settings-controls";

import type { FollowingSession } from "../capabilities/following-session";
import { resolveGuestLiveAlertTruthKeys } from "../domain/guest-live-alert-status";
import { FollowingAddForm } from "./following-add-form";
import { followingQueryKey } from "./use-following-view";

export function FollowingManageScreen({
  permission,
  remotePushAvailable = false,
  session,
}: {
  readonly permission: NotificationPermissionPort;
  readonly remotePushAvailable?: boolean;
  readonly session: FollowingSession;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const membership = useQuery({
    queryFn: () => session.listMembership(),
    queryKey: followingQueryKey("membership"),
    retry: false,
  });
  const notifications = useQuery({
    queryFn: () => session.readNotifications(),
    queryKey: followingQueryKey("notifications"),
    retry: false,
  });
  const permissionSnapshot = useQuery({
    queryFn: () => permission.read(),
    queryKey: followingQueryKey("notification-permission"),
    retry: false,
  });
  const prefs = notifications.data ?? DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["follows"] });
  };
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="following-manage-screen"
    >
      <MobileScreenHeader title={t("discovery.following.manageTitle")} />
      <ManageNotices
        onToggleGuest={() => {
          const next = !prefs.guestFollows;
          void (async () => {
            if (next) {
              await permission.request();
            }
            await session.writeNotifications({
              ...prefs,
              guestFollows: next,
            });
            refresh();
          })();
        }}
        permission={permissionSnapshot.data?.permission ?? "not-requested"}
        prefs={prefs}
        remotePushAvailable={remotePushAvailable}
      />
      <NotificationTruths
        permission={permissionSnapshot.data?.permission ?? "not-requested"}
        prefs={prefs}
        remotePushAvailable={remotePushAvailable}
      />
      <FollowingAddForm
        membership={membership.data ?? []}
        onAdded={refresh}
        session={session}
      />
      {(membership.data ?? []).map((follow) => (
        <ManageRow
          follow={follow}
          key={`${follow.platform}:${follow.channelId}`}
          notify={
            prefs.perChannelNotifications[
              `${follow.platform}:${follow.channelId}`
            ] ?? true
          }
          onRefresh={refresh}
          prefs={prefs}
          session={session}
        />
      ))}
    </ScrollView>
  );
}

function ManageNotices({
  onToggleGuest,
  permission,
  prefs,
  remotePushAvailable,
}: {
  readonly onToggleGuest: () => void;
  readonly permission: NotificationPermissionStatus;
  readonly prefs: LiveNotificationPreferences;
  readonly remotePushAvailable: boolean;
}) {
  const { t } = useTranslation();
  const truths = resolveGuestLiveAlertTruthKeys({
    permission,
    preferences: prefs,
    remotePushAvailable,
  });
  return (
    <>
      <Text selectable style={styles.copy}>
        {t("discovery.following.guestStayOnDevice")}
      </Text>
      <View style={styles.card} testID="following-import-disabled">
        <Text selectable style={styles.cardTitle}>
          {t("discovery.following.importFromPlatforms")}
        </Text>
        <Text selectable style={styles.copy}>
          {t("discovery.following.importDisabled")}
        </Text>
      </View>
      <View style={styles.card} testID="following-push-stub">
        <Text selectable style={styles.cardTitle}>
          {t("discovery.following.systemNotifications")}
        </Text>
        <Text selectable style={styles.copy}>
          {t(`discovery.following.${truths.systemNotificationsKey}`)}
        </Text>
        <SettingsSwitch
          checked={prefs.guestFollows}
          label={t("settings.guestFollowNotifications")}
          onToggle={onToggleGuest}
          testID="following-notify-guest"
        />
      </View>
    </>
  );
}

function NotificationTruths({
  permission,
  prefs,
  remotePushAvailable,
}: {
  readonly permission: NotificationPermissionStatus;
  readonly prefs: LiveNotificationPreferences;
  readonly remotePushAvailable: boolean;
}) {
  const { t } = useTranslation();
  const truths = resolveGuestLiveAlertTruthKeys({
    permission,
    preferences: prefs,
    remotePushAvailable,
  });
  return (
    <View style={styles.card} testID="following-notification-truths">
      <Text selectable style={styles.cardTitle}>
        {t("discovery.following.liveAlertStatus")}
      </Text>
      <Text selectable style={styles.copy}>
        {t(`discovery.following.${truths.eligibilityKey}`)}
      </Text>
      <Text selectable style={styles.copy}>
        {t(`discovery.following.${truths.permissionKey}`)}
      </Text>
      <Text selectable style={styles.copy}>
        {t(`discovery.following.${truths.registrationKey}`)}
      </Text>
      <Text selectable style={styles.copy}>
        {t(`discovery.following.${truths.deliveryKey}`)}
      </Text>
    </View>
  );
}

function ManageRow({
  follow,
  notify,
  onRefresh,
  prefs,
  session,
}: {
  readonly follow: GuestFollow;
  readonly notify: boolean;
  readonly onRefresh: () => void;
  readonly prefs: LiveNotificationPreferences;
  readonly session: FollowingSession;
}) {
  const { t } = useTranslation();
  const toggleLiveAlerts = () => {
    void session
      .writeNotifications(
        setPerChannelLiveNotificationPreference(
          prefs,
          {
            id: follow.channelId,
            platform: follow.platform,
            username: follow.channelLogin,
          },
          !notify,
        ),
      )
      .then(onRefresh);
  };
  return (
    <View
      style={styles.card}
      testID={`following-manage-${follow.platform}-${follow.channelId}`}
    >
      <Text selectable style={styles.cardTitle}>
        {follow.displayName}
      </Text>
      <Text selectable style={styles.copy}>
        {follow.platform} · {follow.channelLogin}
      </Text>
      <View style={styles.row}>
        <MobileButton
          accessibilityLabel={t("discovery.following.unfollowName", {
            name: follow.displayName,
          })}
          onPress={() => {
            void session
              .mutateFollow({
                channelId: follow.channelId,
                platform: follow.platform,
              })
              .then(onRefresh);
          }}
          testID={`following-unfollow-${follow.platform}-${follow.channelId}`}
          variant="destructive"
        >
          {t("discovery.following.unfollow")}
        </MobileButton>
        <Pressable
          accessibilityLabel="Live alerts"
          accessibilityRole="switch"
          accessibilityState={{ checked: notify }}
          onPress={toggleLiveAlerts}
          style={styles.alertToggle}
          testID={`following-notify-${follow.platform}-${follow.channelId}`}
        >
          <Text selectable style={styles.alertToggleLabel}>
            Live alerts
          </Text>
          <Switch
            accessibilityElementsHidden
            importantForAccessibility="no"
            onValueChange={toggleLiveAlerts}
            pointerEvents="none"
            thumbColor={
              notify ? mobileColors.textPrimary : mobileColors.textSecondary
            }
            trackColor={{
              false: mobileColors.border,
              true: mobileColors.twitchBright,
            }}
            value={notify}
          />
        </Pressable>
        <MobileButton
          accessibilityLabel={t("discovery.following.openNameOnPlatform", {
            name: follow.displayName,
            platform: follow.platform,
          })}
          onPress={() => {
            void session.openProviderPage({
              channelLogin: follow.channelLogin,
              platform: follow.platform,
            });
          }}
          testID={`following-provider-${follow.platform}-${follow.channelId}`}
          variant="secondary"
        >
          {t("discovery.following.openOnPlatform", {
            platform: follow.platform,
          })}
        </MobileButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  copy: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  cardTitle: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  alertToggle: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.xSmall,
  },
  alertToggleLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
});
