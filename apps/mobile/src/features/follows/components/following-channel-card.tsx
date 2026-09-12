import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
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
      <Text selectable style={styles.title}>
        {row.follow.displayName}
      </Text>
      <Text selectable style={styles.meta}>
        {row.isLive ? "Live" : "Offline"} · {row.follow.platform}
      </Text>
      <Text selectable style={styles.meta}>
        Guest Follow · not imported
      </Text>
      <Text selectable style={styles.meta}>
        {row.eligible ? "Live alerts eligible" : "Live alerts not eligible"}
      </Text>
      <Pressable
        accessibilityLabel={`Open ${row.follow.displayName} on ${row.follow.platform}`}
        accessibilityRole="button"
        onPress={() =>
          onOpenProvider({
            channelLogin: row.follow.channelLogin,
            platform: row.follow.platform,
          })
        }
        style={styles.action}
        testID={`following-channel-provider-${row.follow.platform}-${row.follow.channelId}`}
      >
        <Text selectable style={styles.actionLabel}>
          {`Open on ${row.follow.platform}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  action: {
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    marginTop: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
  },
  actionLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
