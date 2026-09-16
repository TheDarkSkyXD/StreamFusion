import { Image, StyleSheet, Text, View } from "react-native";
import type { Channel } from "@streamfusion/core/content";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import type { FollowView, WatchAvailability } from "../capabilities/platform-reads";
import { watchAvailabilityCopy } from "../domain/channel-detail";
import {
  followActionLabel,
  followCopy,
  providerPageLabel,
} from "../domain/channel-follow";

export function ChannelHeader({
  channel,
  follow,
  onAddToMultistream,
  onFollow,
  onOpenProviderPage,
  onWatch,
  watch,
}: {
  readonly channel: Channel;
  readonly follow: FollowView;
  readonly onAddToMultistream?: () => void;
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
  const watchEnabled = watch.kind === "available";
  const watchCopy = watchAvailabilityCopy(watch);
  const addCopy = watchEnabled
    ? "Adds this live channel to the Multistream room."
    : "Multistream keeps live channels only.";
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
        <View style={styles.nameRow}>
          <Text accessibilityRole="header" selectable style={mobileType.display}>
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
      <View style={styles.actions}>
        <MobileButton
          accessibilityHint={followCopy(follow)}
          accessibilityLabel={followLabel}
          busy={followBusy}
          disabled={followBusy}
          onPress={onFollow}
          testID="channel-follow"
          variant="primary"
        >
          {followLabel}
        </MobileButton>
        <Text selectable style={styles.followReason} testID="channel-follow-reason">
          {followCopy(follow)}
        </Text>
        <MobileButton
          accessibilityHint={`Opens ${channel.displayName} on ${channel.platform}.`}
          accessibilityLabel={providerPageLabel(channel.platform)}
          onPress={onOpenProviderPage}
          testID="channel-open-provider"
          variant={channel.platform}
        >
          {providerPageLabel(channel.platform)}
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
        <Text selectable style={styles.followReason} testID="channel-watch-reason">
          {watchCopy}
        </Text>
        <MobileButton
          accessibilityHint={addCopy}
          accessibilityLabel="Add to Multistream"
          disabled={!watchEnabled}
          onPress={() => onAddToMultistream?.()}
          testID="channel-add-multistream"
          variant="secondary"
        >
          Add to Multistream
        </MobileButton>
        <Text
          selectable
          style={styles.followReason}
          testID="channel-add-multistream-reason"
        >
          {addCopy}
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
    gap: mobileSpacing.xSmall,
    maxWidth: 168,
  },
  followReason: {
    ...mobileType.label,
  },
});
