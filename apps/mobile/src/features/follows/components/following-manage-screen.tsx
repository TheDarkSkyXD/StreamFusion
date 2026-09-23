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

import type { FollowingSession } from "../capabilities/following-session";
import { followingQueryKey } from "./use-following-view";

export function FollowingManageScreen({
  session,
}: {
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
      <ManageNotices />
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

function ManageNotices() {
  const { t } = useTranslation();
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
    </>
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
