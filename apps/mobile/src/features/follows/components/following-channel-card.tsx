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
        {row.isLive ? "Live" : "Offline"} · {row.follow.platform}
      </Text>
      <Text selectable style={styles.meta}>
        Guest Follow · not imported
      </Text>
      <Text selectable style={styles.meta}>
        {row.eligible ? "Live alerts eligible" : "Live alerts not eligible"}
      </Text>
      <MobileButton
        accessibilityLabel={`Open ${row.follow.displayName} on ${row.follow.platform}`}
        onPress={() =>
          onOpenProvider({
            channelLogin: row.follow.channelLogin,
            platform: row.follow.platform,
          })
        }
        testID={`following-channel-provider-${row.follow.platform}-${row.follow.channelId}`}
        variant={row.follow.platform}
      >
        {`Open on ${row.follow.platform}`}
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
