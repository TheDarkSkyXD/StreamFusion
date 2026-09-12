import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  setPerChannelLiveNotificationPreference,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { FollowingSession } from "../capabilities/following-session";
import { FollowingAddForm } from "./following-add-form";
import { followingQueryKey } from "./use-following-view";

export function FollowingManageScreen({
  session,
}: {
  readonly session: FollowingSession;
}) {
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
      <Text accessibilityRole="header" selectable style={styles.title}>
        Manage Guest Follows
      </Text>
      <ManageNotices
        onToggleGuest={() => {
          void session
            .writeNotifications({
              ...prefs,
              guestFollows: !prefs.guestFollows,
            })
            .then(refresh);
        }}
        prefs={prefs}
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
  prefs,
}: {
  readonly onToggleGuest: () => void;
  readonly prefs: LiveNotificationPreferences;
}) {
  return (
    <>
      <Text selectable style={styles.copy}>
        Guest Follows stay on this device. Account import is unavailable while
        signed out.
      </Text>
      <View style={styles.card} testID="following-import-disabled">
        <Text selectable style={styles.cardTitle}>
          Import from Twitch or Kick
        </Text>
        <Text selectable style={styles.copy}>
          Account follow import is disabled until you connect a platform
          account.
        </Text>
      </View>
      <View style={styles.card} testID="following-push-stub">
        <Text selectable style={styles.cardTitle}>
          System notifications
        </Text>
        <Text selectable style={styles.copy}>
          In-app live alerts can use Guest Follow preferences. System push is
          not shipped yet.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onToggleGuest}
          style={styles.action}
          testID="following-notify-guest"
        >
          <Text selectable style={styles.actionLabel}>
            {prefs.guestFollows
              ? "Guest live alerts on"
              : "Guest live alerts off"}
          </Text>
        </Pressable>
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
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void session
              .mutateFollow({
                channelId: follow.channelId,
                platform: follow.platform,
              })
              .then(onRefresh);
          }}
          style={styles.action}
          testID={`following-unfollow-${follow.platform}-${follow.channelId}`}
        >
          <Text selectable style={styles.actionLabel}>
            Unfollow
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
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
          }}
          style={styles.action}
          testID={`following-notify-${follow.platform}-${follow.channelId}`}
        >
          <Text selectable style={styles.actionLabel}>
            {notify ? "Live alerts on" : "Live alerts off"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void session.openProviderPage({
              channelLogin: follow.channelLogin,
              platform: follow.platform,
            });
          }}
          style={styles.action}
          testID={`following-provider-${follow.platform}-${follow.channelId}`}
        >
          <Text selectable style={styles.actionLabel}>
            Open on {follow.platform}
          </Text>
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
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  action: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
});
