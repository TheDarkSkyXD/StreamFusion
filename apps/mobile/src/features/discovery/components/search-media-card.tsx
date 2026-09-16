import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

export function SearchMediaCard({
  channel,
  duration,
  onPress,
  platform,
  testID,
  thumbnailUrl,
  title,
}: {
  readonly channel: string;
  readonly duration: number;
  readonly onPress?: () => void;
  readonly platform: Platform;
  readonly testID: string;
  readonly thumbnailUrl: string;
  readonly title: string;
}) {
  const body = (
    <>
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
        <MobilePlatformBadge platform={platform} />
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View
        accessibilityLabel={`${title} by ${channel} on ${platform}`}
        style={styles.card}
        testID={testID}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={`Watch ${title} by ${channel} on ${platform}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.card}
      testID={testID}
    >
      {body}
    </Pressable>
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
  card: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  title: {
    ...mobileType.title,
    paddingHorizontal: mobileSpacing.medium,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    paddingHorizontal: mobileSpacing.medium,
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
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    bottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    right: mobileSpacing.small,
  },
  durationLabel: {
    ...mobileType.caption,
    fontWeight: "600",
  },
  mediaMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingVertical: mobileSpacing.medium,
    paddingRight: mobileSpacing.medium,
  },
});
