import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type {
  Category,
  Channel,
  Clip,
  Video,
} from "@streamfusion/core/content";
import { MobileAvatar } from "@mobile/design/avatar";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import { MobileCatalogTags } from "@mobile/design/tag";
import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
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
      <MobileAvatar
        livePlatform={channel.isLive ? channel.platform : null}
        name={channel.displayName}
        size={40}
        uri={channel.avatarUrl}
      />
      <View style={styles.copy}>
        <View style={styles.channelRow}>
          <Text selectable style={styles.title}>
            {channel.displayName}
          </Text>
          {channel.isVerified ? (
            <MobileVerifiedBadge platform={channel.platform} />
          ) : null}
        </View>
        <Text selectable style={styles.meta}>
          {channel.isLive ? "Live" : "Offline"}
        </Text>
      </View>
      <MobilePlatformBadge platform={channel.platform} />
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
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export function SearchCategoryCard({
  category,
  onOpen,
}: {
  readonly category: Category;
  readonly onOpen?: () => void;
}) {
  const content = (
    <>
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
      <View style={styles.categoryCopy}>
        <Text selectable style={styles.categoryTitle}>
          {category.name}
        </Text>
        <View style={styles.categoryMeta}>
          <MobilePlatformBadge platform={category.platform} />
          <MobileCatalogTags
            {...(category.tags === undefined ? {} : { tags: category.tags })}
          />
        </View>
      </View>
    </>
  );
  const label = `${category.name} on ${category.platform}`;
  const testID = `search-category-${category.platform}-${category.id}`;
  if (!onOpen)
    return (
      <View accessibilityLabel={label} style={styles.category} testID={testID}>
        {content}
      </View>
    );
  return (
    <Pressable
      accessibilityHint="Opens category details"
      accessibilityLabel={label}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.category,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
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

function pressProp(
  onPress?: () => void,
): { readonly onPress: () => void } | Record<string, never> {
  return onPress === undefined ? {} : { onPress };
}

const styles = StyleSheet.create({
  row: {
    ...mobilePressRing.rest,
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  pressed: {
    ...mobilePressRing.pressed,
  },
  category: {
    ...mobilePressRing.rest,
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    overflow: "hidden",
    padding: mobileSpacing.small,
    minHeight: 112,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  channelRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  title: {
    ...mobileType.title,
  },
  categoryTitle: {
    ...mobileType.title,
    flexShrink: 1,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  boxArtWrap: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    height: 96,
    overflow: "hidden",
    width: 72,
  },
  media: {
    height: "100%",
    width: "100%",
  },
  categoryMeta: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  categoryCopy: { flex: 1, gap: mobileSpacing.small, minWidth: 0 },
});
