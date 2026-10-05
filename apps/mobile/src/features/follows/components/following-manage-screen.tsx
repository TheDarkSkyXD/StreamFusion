import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  setPerChannelLiveNotificationPreference,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import { MobileButton } from "@mobile/design/button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileSwitchRow } from "@mobile/design/list-row";
import {
  mobileColors,
  mobileRadii,
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
  const { t } = useTranslation();
  const [addVisible, setAddVisible] = useState(false);
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
  const guestMembership = useQuery({
    queryFn: () => session.listGuestMembership(),
    queryKey: ["follows", "guest-membership"],
    retry: false,
  });
  const prefs = notifications.data ?? DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["follows"] });
  };
  const guestKeys = new Set(
    (guestMembership.data ?? []).map(
      (follow) => `${follow.platform}:${follow.channelId}`,
    ),
  );
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={styles.scroll}
        testID="following-manage-screen"
      >
        <MobileButton
          accessibilityLabel={t("discovery.following.addGuestFollow")}
          onPress={() => setAddVisible(true)}
          testID="following-add-open"
          variant="primary"
        >
          {t("discovery.following.addGuestFollow")}
        </MobileButton>
        <ManageNotices />
        {guestMembership.isPending ? (
          <Text selectable style={styles.copy}>
            Loading follow sources.
          </Text>
        ) : guestMembership.isError ? (
          <MobileButton
            accessibilityLabel="Retry follow sources"
            onPress={() => void guestMembership.refetch()}
            testID="following-retry-sources"
            variant="secondary"
          >
            Retry follow sources
          </MobileButton>
        ) : (
          (membership.data ?? []).map((follow) => (
            <ManageRow
              follow={follow}
              key={`${follow.platform}:${follow.channelId}`}
              source={
                guestKeys.has(`${follow.platform}:${follow.channelId}`)
                  ? "guest"
                  : "account"
              }
              notify={
                prefs.perChannelNotifications[
                  `${follow.platform}:${follow.channelId}`
                ] ?? true
              }
              onRefresh={refresh}
              prefs={prefs}
              session={session}
            />
          ))
        )}
      </ScrollView>
      <MobileBottomSheet
        onDismiss={() => setAddVisible(false)}
        title={t("discovery.following.addGuestFollow")}
        visible={addVisible}
      >
        <FollowingAddForm
          membership={guestMembership.data ?? []}
          onAdded={() => {
            refresh();
            setAddVisible(false);
          }}
          session={session}
        />
      </MobileBottomSheet>
    </>
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
          Account follows appear when a connected provider allows reading them.
          Open the provider page to change an account follow.
        </Text>
      </View>
    </>
  );
}

export function ManageRow({
  follow,
  source,
  notify,
  onRefresh,
  prefs,
  session,
}: {
  readonly follow: GuestFollow;
  readonly source: "guest" | "account";
  readonly notify: boolean;
  readonly onRefresh: () => void;
  readonly prefs: LiveNotificationPreferences;
  readonly session: Pick<FollowingSession, "openProviderPage" | "removeGuestFollow" | "writeNotifications">;
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
      <Text selectable style={styles.copy}>
        {source === "guest" ? "Guest Follow" : "Account follow"}
      </Text>
      <View style={styles.row}>
        {source === "guest" ? (
          <MobileButton
            accessibilityLabel={t("discovery.following.unfollowName", {
              name: follow.displayName,
            })}
            onPress={() => {
              void session
                .removeGuestFollow({
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
        ) : (
          <MobileButton
            accessibilityLabel={`Manage ${follow.displayName} on ${follow.platform}`}
            onPress={() => {
              void session.openProviderPage({
                platform: follow.platform,
                channelLogin: follow.channelLogin,
              });
            }}
            testID={`following-manage-provider-${follow.platform}-${follow.channelId}`}
            variant={follow.platform}
          >
            {`Manage on ${follow.platform}`}
          </MobileButton>
        )}
      </View>
      <View style={styles.alertRow}>
        <MobileSwitchRow
          onChange={toggleLiveAlerts}
          testID={`following-notify-${follow.platform}-${follow.channelId}`}
          title="Live alerts"
          value={notify}
        />
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
  alertRow: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
  },
});
