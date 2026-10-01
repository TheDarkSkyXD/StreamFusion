import { Pressable, StyleSheet, View } from "react-native";

import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
} from "@mobile/design/tokens";
import type { Stream } from "@streamfusion/core/content";

import { LiveStreamCardContent } from "./live-stream-card-content";

export function HomeStreamCard({
  onOpen,
  stream,
}: {
  readonly onOpen?: () => void;
  readonly stream: Stream;
}) {
  const content = (
    <LiveStreamCardContent
      stream={stream}
      tagsTestID={`home-stream-tags-${stream.id}`}
    />
  );
  const label = `${stream.channelDisplayName} live on ${stream.platform}, ${stream.viewerCount} viewers`;
  const testID = `home-stream-${stream.platform}-${stream.id}`;
  if (onOpen === undefined) {
    return (
      <View accessibilityLabel={label} style={styles.card} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Starts watching this live stream"
      accessibilityLabel={label}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
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
});
