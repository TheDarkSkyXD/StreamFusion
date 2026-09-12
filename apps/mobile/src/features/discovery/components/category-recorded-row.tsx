import { Image, StyleSheet, Text, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";

export function CategoryRecordedRow({
  item,
}: {
  readonly item: Clip | Video;
}) {
  const isClip = "clipUrl" in item;
  return (
    <View
      accessibilityLabel={`${item.title} ${isClip ? "clip" : "video"}`}
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
        <Text selectable style={styles.title}>
          {item.title}
        </Text>
        <Text selectable style={styles.meta}>
          {`${item.channelDisplayName} · ${item.viewCount} views`}
        </Text>
        <Text selectable style={styles.kind}>
          {isClip ? "CLIP" : item.type.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    overflow: "hidden",
  },
  thumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: 148,
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
    flex: 1,
    gap: mobileSpacing.xSmall,
    justifyContent: "center",
    paddingVertical: mobileSpacing.small,
    paddingRight: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  kind: {
    color: mobileColors.textCategory,
    fontSize: 11,
    fontWeight: "700",
  },
});
