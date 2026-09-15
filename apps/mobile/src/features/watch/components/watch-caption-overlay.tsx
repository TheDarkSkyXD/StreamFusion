import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileRadii, mobileSpacing } from "@mobile/design/tokens";

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
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    borderRadius: mobileRadii.medium,
    color: mobileColors.textPrimary,
    fontWeight: "700",
    lineHeight: 22,
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
