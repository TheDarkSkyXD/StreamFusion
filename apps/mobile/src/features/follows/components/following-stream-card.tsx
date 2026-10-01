import { Pressable, StyleSheet } from "react-native";
import type { Stream } from "@streamfusion/core/content";

import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
} from "@mobile/design/tokens";
import { LiveStreamCardContent } from "@mobile/features/discovery/components/live-stream-card-content";

export function FollowingStreamCard({
  onOpen,
  stream,
}: {
  readonly onOpen: () => void;
  readonly stream: Stream;
}) {
  return (
    <Pressable
      accessibilityHint="Opens this live stream in Watch"
      accessibilityLabel={`${stream.channelDisplayName} live on ${stream.platform}, ${stream.viewerCount} viewers`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`following-stream-${stream.platform}-${stream.id}`}
    >
      <LiveStreamCardContent stream={stream} />
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
