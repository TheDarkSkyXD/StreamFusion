import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type {
  Category,
  Channel,
  Clip,
  Video,
} from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import { SearchMediaCard } from "./search-media-card";

export function SearchChannelCard({
  channel,
  onOpen,
}: {
  readonly channel: Channel;
  readonly onOpen?: () => void;
}) {
  const body = (
    <>
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
        <Text selectable style={styles.title}>
          {channel.displayName}
        </Text>
        <Text selectable style={styles.meta}>
          {channel.isLive ? "Live" : "Offline"}
        </Text>
      </View>
      <PlatformBadge platform={channel.platform} />
    </>
  );
  const label = `${channel.displayName} on ${channel.platform}${channel.isLive ? ", live" : ""}`;
  const testID = `search-channel-${channel.platform}-${channel.id}`;
  if (!onOpen) {
    return (
      <View accessibilityLabel={label} style={styles.row} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onOpen}
      style={styles.row}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export function SearchCategoryCard({
  category,
}: {
  readonly category: Category;
}) {
  return (
    <View
      accessibilityLabel={`${category.name} on ${category.platform}`}
      style={styles.category}
      testID={`search-category-${category.platform}-${category.id}`}
    >
      <View style={styles.boxArtWrap}>
        {category.boxArtUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: category.boxArtUrl }}
            style={styles.media}
          />
        ) : (
          <View style={styles.media} />
        )}
      </View>
      <Text selectable style={styles.title}>
        {category.name}
      </Text>
      <PlatformBadge platform={category.platform} />
    </View>
  );
}

export function SearchVideoCard({
  onWatch,
  video,
}: {
  readonly onWatch?: (video: Video) => void;
  readonly video: Video;
}) {
  return (
    <SearchMediaCard
      channel={video.channelDisplayName}
      duration={video.duration}
      platform={video.platform}
      testID={`search-video-${video.platform}-${video.id}`}
      thumbnailUrl={video.thumbnailUrl}
      title={video.title}
      {...pressProp(onWatch ? () => onWatch(video) : undefined)}
    />
  );
}

export function SearchClipCard({
  clip,
  onWatch,
}: {
  readonly clip: Clip;
  readonly onWatch?: (clip: Clip) => void;
}) {
  return (
    <SearchMediaCard
      channel={clip.channelDisplayName}
      duration={clip.duration}
      platform={clip.platform}
      testID={`search-clip-${clip.platform}-${clip.id}`}
      thumbnailUrl={clip.thumbnailUrl}
      title={clip.title}
      {...pressProp(onWatch ? () => onWatch(clip) : undefined)}
    />
  );
}

function PlatformBadge({ platform }: { readonly platform: Platform }) {
  return (
    <View
      style={[
        styles.platformBadge,
        platform === "twitch" ? styles.twitchBadge : styles.kickBadge,
      ]}
    >
      <Text selectable style={styles.platformLabel}>
        {platform === "twitch" ? "TWITCH" : "KICK"}
      </Text>
    </View>
  );
}

function pressProp(
  onPress?: () => void,
): { readonly onPress: () => void } | Record<string, never> {
  return onPress === undefined ? {} : { onPress };
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  category: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    overflow: "hidden",
    paddingBottom: mobileSpacing.medium,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 40,
    width: 40,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    paddingHorizontal: mobileSpacing.medium,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    paddingHorizontal: mobileSpacing.medium,
  },
  boxArtWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  media: {
    height: "100%",
    width: "100%",
  },
  platformBadge: {
    borderRadius: mobileRadii.small,
    justifyContent: "center",
    minHeight: 24,
    paddingHorizontal: mobileSpacing.small,
  },
  twitchBadge: {
    backgroundColor: "#9146ff",
  },
  kickBadge: {
    backgroundColor: "#53fc18",
  },
  platformLabel: {
    color: mobileColors.background,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
});
