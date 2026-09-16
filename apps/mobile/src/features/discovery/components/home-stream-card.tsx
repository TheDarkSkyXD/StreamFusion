import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { Stream } from "@streamfusion/core/content";

export function HomeStreamCard({
  onOpen,
  stream,
}: {
  readonly onOpen?: () => void;
  readonly stream: Stream;
}) {
  const category = stream.categoryName ?? stream.language;
  const card = (
    <View
      accessibilityLabel={`${stream.channelDisplayName} live on ${stream.platform}`}
      style={styles.card}
      testID={`home-stream-${stream.platform}-${stream.id}`}
    >
      <View style={styles.thumbWrap}>
        {stream.thumbnailUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: stream.thumbnailUrl }}
            style={styles.thumb}
          />
        ) : (
          <View style={styles.thumb} />
        )}
        <View style={styles.liveBadge}>
          <Text selectable style={styles.liveLabel}>
            LIVE
          </Text>
        </View>
        <View style={styles.viewerBadge}>
          <Text selectable style={styles.viewerLabel}>
            {`${stream.viewerCount} viewers`}
          </Text>
        </View>
      </View>
      <View style={styles.meta}>
        {stream.channelAvatar ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: stream.channelAvatar }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatar} />
        )}
        <View style={styles.copy}>
          <Text selectable style={styles.title}>
            {stream.title}
          </Text>
          <Text selectable style={styles.channel}>
            {stream.channelDisplayName}
          </Text>
          {category ? (
            <Text selectable style={styles.category}>
              {stream.categoryName
                ? `${stream.categoryName}${stream.language ? ` · ${stream.language}` : ""}`
                : stream.language}
            </Text>
          ) : null}
        </View>
        <MobilePlatformBadge platform={stream.platform} />
      </View>
    </View>
  );
  if (onOpen === undefined) return card;
  return (
    <Pressable
      accessibilityHint="Opens channel details"
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={onOpen}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
  },
  thumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  thumb: {
    height: "100%",
    width: "100%",
  },
  liveBadge: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.small,
    left: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    top: mobileSpacing.small,
  },
  liveLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
    viewerBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    bottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    right: mobileSpacing.small,
  },
  viewerLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
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
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  title: {
    ...mobileType.title,
  },
  channel: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  category: {
    color: mobileColors.textCategory,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
});
