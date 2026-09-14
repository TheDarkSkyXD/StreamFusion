import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
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
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
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
