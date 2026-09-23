import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

export function ChannelMediaRow({
  item,
  onPress,
}: {
  readonly item: Clip | Video;
  readonly onPress?: () => void;
}) {
  const body = <MediaBody item={item} />;
  const label = `Watch ${item.title} by ${item.channelDisplayName} on ${item.platform}`;
  if (!onPress) {
    return (
      <View
        accessibilityLabel={label}
        style={styles.card}
        testID={`channel-media-${item.platform}-${item.id}`}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`channel-media-${item.platform}-${item.id}`}
    >
      {body}
    </Pressable>
  );
}

function MediaBody({ item }: { readonly item: Clip | Video }) {
  return (
    <>
      <View style={styles.thumbWrap}>
        {item.thumbnailUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: item.thumbnailUrl }}
            style={styles.thumb}
          />
        ) : (
          <View style={styles.thumb} />
        )}
        <View style={styles.durationBadge}>
          <Text selectable style={styles.badgeLabel}>
            {formatDuration(item.duration)}
          </Text>
        </View>
        {item.viewCount > 0 ? (
          <View style={styles.viewsBadge}>
            <Text selectable style={styles.badgeLabel}>
              {`${item.viewCount} views`}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        {item.channelAvatar ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: item.channelAvatar }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatar} />
        )}
        <View style={styles.copy}>
          <Text numberOfLines={2} selectable style={styles.title}>
            {item.title}
          </Text>
          <Text numberOfLines={1} selectable style={styles.channel}>
            {item.channelDisplayName}
          </Text>
        </View>
        <MobilePlatformBadge platform={item.platform} />
      </View>
    </>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  card: {
    ...mobilePressRing.rest,
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
  },
  pressed: {
    ...mobilePressRing.pressed,
  },
  thumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  thumb: { height: "100%", width: "100%" },
  durationBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    bottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    right: mobileSpacing.small,
  },
  viewsBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    bottom: mobileSpacing.small,
    left: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
  },
  badgeLabel: {
    ...mobileType.caption,
    fontWeight: "600",
  },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 40,
    width: 40,
  },
  copy: { flex: 1, gap: mobileSpacing.xSmall },
  title: {
    ...mobileType.title,
  },
  channel: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
