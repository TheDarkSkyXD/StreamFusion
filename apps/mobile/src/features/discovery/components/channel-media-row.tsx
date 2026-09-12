import { Image, StyleSheet, Text, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";

import { mobileColors, mobileRadii, mobileSpacing } from "@mobile/design/tokens";

export function ChannelMediaRow({
  item,
}: {
  readonly item: Clip | Video;
}) {
  const views = `${item.viewCount} views`;
  const duration = formatDuration(item.duration);
  return (
    <View
      style={styles.row}
      testID={`channel-media-${item.platform}-${item.id}`}
    >
      {item.thumbnailUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: item.thumbnailUrl }}
          style={styles.thumb}
        />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.copy}>
        <Text selectable style={styles.title}>
          {item.title}
        </Text>
        <Text selectable style={styles.meta}>
          {`${duration} · ${views}`}
        </Text>
      </View>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    overflow: "hidden",
  },
  thumb: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: 128,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    justifyContent: "center",
    paddingRight: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
});
