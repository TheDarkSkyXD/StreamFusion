import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Channel } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { FollowView, WatchAvailability } from "../capabilities/platform-reads";
import {
  followActionLabel,
  followCopy,
  providerPageLabel,
} from "../domain/channel-follow";

export function ChannelHeader({
  channel,
  follow,
  onFollow,
  onOpenProviderPage,
  onWatch,
  watch,
}: {
  readonly channel: Channel;
  readonly follow: FollowView;
  readonly onFollow: () => void;
  readonly onOpenProviderPage: () => void;
  readonly onWatch: () => void;
  readonly watch: WatchAvailability;
}) {
  const followers =
    channel.followerCount === undefined
      ? "Followers unavailable"
      : `${channel.followerCount} followers`;
  const followBusy = follow.kind === "pending";
  const followLabel = followActionLabel(follow);
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
          accessibilityLabel={followLabel}
          accessibilityRole="button"
          accessibilityState={{ busy: followBusy, disabled: followBusy }}
          disabled={followBusy}
          onPress={onFollow}
          style={({ pressed }) => [
            styles.follow,
            followBusy ? styles.busy : null,
            pressed ? styles.pressed : null,
          ]}
          testID="channel-follow"
        >
          <Text selectable style={styles.followLabel}>
            {followLabel}
          </Text>
        </Pressable>
        <Text selectable style={styles.followReason} testID="channel-follow-reason">
          {followCopy(follow)}
        </Text>
        <Pressable
          accessibilityHint={`Opens ${channel.displayName} on ${channel.platform}.`}
          accessibilityLabel={providerPageLabel(channel.platform)}
          accessibilityRole="button"
          onPress={onOpenProviderPage}
          style={({ pressed }) => [
            styles.provider,
            pressed ? styles.pressed : null,
          ]}
          testID="channel-open-provider"
        >
          <Text selectable style={styles.providerLabel}>
            {providerPageLabel(channel.platform)}
          </Text>
        </Pressable>
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
    maxWidth: 148,
  },
  follow: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  busy: {
    opacity: 0.72,
  },
  pressed: {
    opacity: 0.86,
  },
  followLabel: {
    color: mobileColors.background,
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
  provider: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  providerLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
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
