import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { MobileAvatar } from "./avatar";
import { MobilePlatformBadge } from "./platform-badge";
import { mobileColors, mobileRadii, mobileSpacing, mobileType } from "./tokens";

export function MobileMediaCardContent({
  avatarUri,
  category,
  channel,
  compact = false,
  live = false,
  metadata,
  platform,
  thumbnail,
  thumbnailUri,
  tags,
  title,
  viewerLabel,
  viewerAccessibilityLabel,
  viewerTestID,
}: {
  readonly avatarUri?: string | null;
  readonly category?: string;
  readonly channel: string;
  readonly compact?: boolean;
  readonly live?: boolean;
  readonly metadata?: ReactNode;
  readonly platform: "twitch" | "kick";
  readonly thumbnail?: ReactNode;
  readonly thumbnailUri?: string;
  readonly tags?: ReactNode;
  readonly title: string;
  readonly viewerLabel?: string;
  readonly viewerAccessibilityLabel?: string;
  readonly viewerTestID?: string;
}) {
  return (
    <View style={[styles.card, compact ? styles.compact : null]}>
      <View
        style={[
          styles.thumbnail,
          compact ? styles.smallThumbnail : null,
          !thumbnail && !thumbnailUri ? styles.placeholder : null,
        ]}
      >
        {thumbnail ??
          (thumbnailUri ? (
            <Image
              accessibilityIgnoresInvertColors
              source={{ uri: thumbnailUri }}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
            />
          ) : null)}
        {live ? (
          <View style={styles.live}>
            <Text style={mobileType.caption}>LIVE</Text>
          </View>
        ) : null}
        {viewerLabel ? (
          <View style={styles.viewers}>
            <Text
              accessibilityLabel={viewerAccessibilityLabel}
              testID={viewerTestID}
              style={mobileType.caption}
            >
              {viewerLabel}
            </Text>
          </View>
        ) : null}
        {!compact ? (
          <View style={styles.platform}>
            <MobilePlatformBadge platform={platform} variant="icon" />
          </View>
        ) : null}
      </View>
      <View style={styles.metadata}>
        {!compact ? (
          <MobileAvatar name={channel} uri={avatarUri ?? null} />
        ) : null}
        <View style={styles.copy}>
          <View style={styles.channel}>
            <Text numberOfLines={1} style={styles.name}>
              {channel}
            </Text>
            {metadata}
          </View>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          {category ? (
            <Text numberOfLines={1} style={styles.category}>
              {category}
            </Text>
          ) : null}
          {tags}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: mobileSpacing.small },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.medium,
  },
  thumbnail: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
  },
  smallThumbnail: { width: 116 },
  placeholder: { backgroundColor: mobileColors.surfaceMuted },
  live: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.small,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
    top: 8,
    left: 8,
  },
  viewers: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  platform: { position: "absolute", top: 8, right: 8 },
  metadata: {
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    flex: 1,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.xSmall,
    flexWrap: "wrap",
  },
  name: { ...mobileType.title, fontSize: 14, flexShrink: 1 },
  title: {
    ...mobileType.body,
    fontSize: 14,
    lineHeight: 20,
    color: mobileColors.textPrimary,
  },
  category: { ...mobileType.label, color: mobileColors.textCategory },
});
