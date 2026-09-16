import { StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

export function WatchCaptionOverlay({
  text,
}: {
  readonly text: string;
}) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={styles.overlay} testID="watch-caption-overlay">
      <Text selectable style={styles.cue} testID="watch-caption-cue">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cue: {
    ...mobileType.title,
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.medium,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
    textAlign: "center",
  },
  overlay: {
    bottom: mobileSpacing.medium,
    left: mobileSpacing.medium,
    position: "absolute",
    right: mobileSpacing.medium,
  },
});
