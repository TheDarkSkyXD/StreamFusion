import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";

export function CategoryRecordedRow({
  item,
  onPress,
}: {
  readonly item: Clip | Video;
  readonly onPress?: () => void;
}) {
  const isClip = "clipUrl" in item;
  return (
    <Pressable
      accessibilityLabel={`${item.title} ${isClip ? "clip" : "video"}`}
      accessibilityRole={onPress === undefined ? undefined : "button"}
      disabled={onPress === undefined}
      onPress={onPress}
      style={styles.row}
      testID={`category-recorded-${item.platform}-${item.id}`}
    >
      <View style={styles.thumbWrap}>
        {item.thumbnailUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: item.thumbnailUrl }}
            style={styles.thumb}
          />
        ) : (
          <View style={styles.thumbFallback}>
            <Text selectable style={styles.fallback}>
              {item.title}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} selectable style={styles.title}>
          {item.title}
        </Text>
        <View style={styles.metadata}>
          <Text selectable style={styles.meta}>
            {`${item.channelDisplayName} · ${item.viewCount} views`}
          </Text>
          <View style={styles.identity}>
            <Text selectable style={styles.kind}>
              {isClip ? "CLIP" : item.type.toUpperCase()}
            </Text>
            <MobilePlatformBadge platform={item.platform} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
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
  thumbFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.small,
  },
  fallback: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  copy: {
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  meta: {
    color: mobileColors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  metadata: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  kind: {
    color: mobileColors.textCategory,
    fontSize: 11,
    fontWeight: "700",
  },
});
