import { Image, StyleSheet, Text, View } from "react-native";
import { Bell, BellOff } from "lucide-react-native";
import type { Channel } from "@streamfusion/core/content";

import { MobileAvatar } from "@mobile/design/avatar";
import { MobileButton } from "@mobile/design/button";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import type {
  FollowView,
  WatchAvailability,
} from "../capabilities/platform-reads";
import { watchAvailabilityCopy } from "../domain/channel-detail";
import { followActionLabel, followCopy } from "../domain/channel-follow";

export function ChannelHeader({
  channel,
  follow,
  onFollow,
  onWatch,
  liveAlerts,
  onToggleLiveAlerts,
  watch,
}: {
  readonly channel: Channel;
  readonly follow: FollowView;
  readonly onFollow: () => void;
  readonly onWatch: () => void;
  readonly liveAlerts?: boolean;
  readonly onToggleLiveAlerts?: () => void;
  readonly watch: WatchAvailability;
}) {
  const followers =
    channel.followerCount === undefined
      ? "Followers unavailable"
      : `${channel.followerCount} followers`;
  const followBusy = follow.kind === "pending";
  const followLabel = followActionLabel(follow);
  const watchEnabled = watch.kind === "available";
  const watchCopy = watchAvailabilityCopy(watch);
  return (
    <View style={styles.header} testID="channel-header">
      {channel.bannerUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={{ uri: channel.bannerUrl }}
          style={styles.banner}
          testID="channel-banner"
        />
      ) : null}
      <View style={styles.identity}>
        <MobileAvatar
          livePlatform={channel.isLive ? channel.platform : null}
          name={channel.displayName}
          size={64}
          uri={channel.avatarUrl}
        />
        <View style={styles.copy}>
          <View style={styles.nameRow}>
            <Text
              accessibilityRole="header"
              selectable
              style={mobileType.display}
            >
              {channel.displayName}
            </Text>
            {channel.isVerified ? (
              <MobileVerifiedBadge platform={channel.platform} />
            ) : null}
          </View>
          <Text selectable style={styles.meta}>
            {followers}
          </Text>
          <MobilePlatformBadge platform={channel.platform} />
        </View>
        {onToggleLiveAlerts !== undefined && liveAlerts !== undefined ? (
          <MobileIconButton
            label={liveAlerts ? "Turn off live alerts" : "Turn on live alerts"}
            onPress={onToggleLiveAlerts}
            testID="channel-live-alerts"
          >
            {liveAlerts ? (
              <Bell color={mobileColors.textPrimary} size={20} />
            ) : (
              <BellOff color={mobileColors.textPrimary} size={20} />
            )}
          </MobileIconButton>
        ) : null}
      </View>
      <View style={styles.actions}>
        <View style={styles.primaryActions}>
          <MobileButton
            accessibilityHint={followCopy(follow)}
            accessibilityLabel={followLabel}
            busy={followBusy}
            disabled={followBusy}
            onPress={onFollow}
            testID="channel-follow"
            variant={
              follow.kind === "guest-present" ? "secondary" : channel.platform
            }
          >
            {followLabel}
          </MobileButton>
          <MobileButton
            accessibilityHint={watchCopy}
            accessibilityLabel="Watch"
            disabled={!watchEnabled}
            onPress={onWatch}
            testID="channel-watch"
            variant="primary"
          >
            Watch
          </MobileButton>
        </View>
        <Text
          selectable
          style={styles.followReason}
          testID="channel-follow-reason"
        >
          {followCopy(follow)}
        </Text>
        <Text
          selectable
          style={styles.followReason}
          testID="channel-watch-reason"
        >
          {watchCopy}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: mobileSpacing.medium,
  },
  banner: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.large,
    height: 132,
    width: "100%",
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.medium,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  meta: {
    ...mobileType.body,
  },
  actions: {
    gap: mobileSpacing.small,
  },
  primaryActions: { flexDirection: "row", gap: mobileSpacing.small },
  followReason: {
    ...mobileType.label,
  },
});
