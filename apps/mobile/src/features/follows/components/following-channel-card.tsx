import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import type { FollowingChannelRow } from "../capabilities/following-session";

export function FollowingChannelCard({
  onOpenProvider,
  row,
}: {
  readonly onOpenProvider: (target: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }) => void;
  readonly row: FollowingChannelRow;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={styles.card}
      testID={`following-channel-${row.follow.platform}-${row.follow.channelId}`}
    >
      <View style={styles.heading}>
        <Text selectable style={styles.title}>
          {row.follow.displayName}
        </Text>
        <MobilePlatformBadge platform={row.follow.platform} />
      </View>
      <Text selectable style={styles.meta}>
        {row.isLive ? t("discovery.live") : t("discovery.offline")} · {row.follow.platform}
      </Text>
      <Text selectable style={styles.meta}>
        {row.eligible
          ? t("discovery.following.liveAlertsEligible")
          : t("discovery.following.liveAlertsNotEligible")}
      </Text>
      <MobileButton
        accessibilityLabel={t("discovery.following.openNameOnPlatform", {
          name: row.follow.displayName,
          platform: row.follow.platform,
        })}
        onPress={() =>
          onOpenProvider({
            channelLogin: row.follow.channelLogin,
            platform: row.follow.platform,
          })
        }
        testID={`following-channel-provider-${row.follow.platform}-${row.follow.channelId}`}
        variant={row.follow.platform}
      >
        {t("discovery.following.openOnPlatform", { platform: row.follow.platform })}
      </MobileButton>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
  },
  title: {
    ...mobileType.title,
    flex: 1,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
