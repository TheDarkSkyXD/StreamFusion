import { Image, StyleSheet, Text, View } from "react-native";

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

export function SearchChannelCard({
  channel,
}: {
  readonly channel: Channel;
}) {
  return (
    <View
      accessibilityLabel={`${channel.displayName} on ${channel.platform}${channel.isLive ? ", live" : ""}`}
      style={styles.row}
      testID={`search-channel-${channel.platform}-${channel.id}`}
    >
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
    </View>
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

export function SearchVideoCard({ video }: { readonly video: Video }) {
  return (
    <MediaCard
      channel={video.channelDisplayName}
      duration={video.duration}
      platform={video.platform}
      testID={`search-video-${video.platform}-${video.id}`}
      thumbnailUrl={video.thumbnailUrl}
      title={video.title}
    />
  );
}

export function SearchClipCard({ clip }: { readonly clip: Clip }) {
  return (
    <MediaCard
      channel={clip.channelDisplayName}
      duration={clip.duration}
      platform={clip.platform}
      testID={`search-clip-${clip.platform}-${clip.id}`}
      thumbnailUrl={clip.thumbnailUrl}
      title={clip.title}
    />
  );
}

function MediaCard({
  channel,
  duration,
  platform,
  testID,
  thumbnailUrl,
  title,
}: {
  readonly channel: string;
  readonly duration: number;
  readonly platform: Platform;
  readonly testID: string;
  readonly thumbnailUrl: string;
  readonly title: string;
}) {
  return (
    <View
      accessibilityLabel={`${title} by ${channel} on ${platform}`}
      style={styles.card}
      testID={testID}
    >
      <View style={styles.wideWrap}>
        {thumbnailUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: thumbnailUrl }}
            style={styles.media}
          />
        ) : (
          <View style={styles.media} />
        )}
        <View style={styles.durationBadge}>
          <Text selectable style={styles.durationLabel}>
            {formatDuration(duration)}
          </Text>
        </View>
      </View>
      <View style={styles.mediaMeta}>
        <View style={styles.copy}>
          <Text selectable style={styles.title}>
            {title}
          </Text>
          <Text selectable style={styles.meta}>
            {channel}
          </Text>
        </View>
        <PlatformBadge platform={platform} />
      </View>
    </View>
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

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
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
  wideWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  media: {
    height: "100%",
    width: "100%",
  },
  durationBadge: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: mobileRadii.small,
    bottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    right: mobileSpacing.small,
  },
  durationLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
  },
  mediaMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingVertical: mobileSpacing.medium,
    paddingRight: mobileSpacing.medium,
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
