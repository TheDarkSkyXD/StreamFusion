import { Pressable, StyleSheet, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";

import { MobileAvatar } from "@mobile/design/avatar";
import { MobileMediaCardContent } from "@mobile/design/media-card";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";

export function FollowingMediaCard({
  item,
  onPress,
  testID,
}: {
  readonly item: Clip | Video;
  readonly onPress?: () => void;
  readonly testID: string;
}) {
  const body = (
    <MobileMediaCardContent
      avatarUri={item.channelAvatar}
      category={`${item.viewCount.toLocaleString()} views`}
      channel={item.channelDisplayName}
      compact
      metadata={
        <View style={styles.channelMeta}>
          <MobileAvatar
            name={item.channelDisplayName}
            size={20}
            uri={item.channelAvatar}
          />
          <MobilePlatformBadge platform={item.platform} variant="icon" />
        </View>
      }
      platform={item.platform}
      thumbnailUri={item.thumbnailUrl}
      title={item.title}
      viewerAccessibilityLabel={`${formatDuration(item.duration)} duration`}
      viewerLabel={formatDuration(item.duration)}
    />
  );
  const label = `Watch ${item.title} by ${item.channelDisplayName} on ${item.platform}`;
  if (!onPress) {
    return (
      <View accessibilityLabel={label} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      testID={testID}
    >
      {body}
    </Pressable>
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
  channelMeta: { alignItems: "center", flexDirection: "row", gap: 4 },
  pressed: { opacity: 0.76 },
});
