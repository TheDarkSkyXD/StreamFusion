import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Channel } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { FollowView, WatchAvailability } from "../capabilities/platform-reads";
import { followCopy } from "../domain/channel-follow";

export function ChannelHeader({
  channel,
  follow,
  onWatch,
  watch,
}: {
  readonly channel: Channel;
  readonly follow: FollowView;
  readonly onWatch: () => void;
  readonly watch: WatchAvailability;
}) {
  const followers =
    channel.followerCount === undefined
      ? "Followers unavailable"
      : `${channel.followerCount} followers`;
  return (
    <View style={styles.header} testID="channel-header">
      {channel.avatarUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: channel.avatarUrl }}
          style={styles.avatar}
        />
      ) : (
        <View style={styles.avatar} />
      )}
      <View style={styles.copy}>
        <Text accessibilityRole="header" selectable style={styles.name}>
          {channel.displayName}
        </Text>
        <Text selectable style={styles.meta}>
          {followers}
        </Text>
        <View
          style={[
            styles.platformBadge,
            channel.platform === "twitch" ? styles.twitch : styles.kick,
          ]}
        >
          <Text selectable style={styles.platformLabel}>
            {channel.platform === "twitch" ? "TWITCH" : "KICK"}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityHint={followCopy(follow)}
          accessibilityLabel="Follow"
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={styles.follow}
          testID="channel-follow"
        >
          <Text selectable style={styles.followLabel}>
            Follow
          </Text>
        </Pressable>
        <Text selectable style={styles.followReason} testID="channel-follow-reason">
          {followCopy(follow)}
        </Text>
        <Pressable
          accessibilityHint={watch.reason}
          accessibilityLabel="Watch"
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          onPress={onWatch}
          style={styles.watch}
          testID="channel-watch"
        >
          <Text selectable style={styles.watchLabel}>
            Watch
          </Text>
        </Pressable>
        <Text selectable style={styles.followReason} testID="channel-watch-reason">
          {watch.reason}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    gap: mobileSpacing.medium,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 72,
    width: 72,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  name: {
    color: mobileColors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  platformBadge: {
    alignSelf: "flex-start",
    borderRadius: mobileRadii.small,
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.small,
  },
  twitch: { backgroundColor: "#9146ff" },
  kick: { backgroundColor: "#53fc18" },
  platformLabel: {
    color: mobileColors.background,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  actions: {
    gap: mobileSpacing.xSmall,
    maxWidth: 140,
  },
  follow: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    opacity: 0.72,
    paddingHorizontal: mobileSpacing.medium,
  },
  followLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  followReason: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  watch: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceMuted,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    opacity: 0.72,
    paddingHorizontal: mobileSpacing.medium,
  },
  watchLabel: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
});
