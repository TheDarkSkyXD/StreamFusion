import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { ChannelFixtureMode } from "../domain/channel-fixture";

const MODES: readonly ChannelFixtureMode[] = [
  "live",
  "ready",
  "loading",
  "stale-cache",
  "channel-empty",
  "channel-failed",
  "kick-unsupported",
];

export function ChannelProofControls({
  mode,
  onSelect,
}: {
  readonly mode: ChannelFixtureMode;
  readonly onSelect: (mode: ChannelFixtureMode) => void;
}) {
  return (
    <View style={styles.proof} testID="channel-proof-controls">
      <Text selectable style={styles.proofSource} testID="channel-proof-source">
        issue-148-d05-60c4
      </Text>
      <View style={styles.proofRow}>
        {MODES.map((next) => (
          <Pressable
            accessibilityLabel={`Inject ${next} channel state`}
            accessibilityRole="button"
            key={next}
            onPress={() => onSelect(next)}
            style={({ pressed }) => [
              styles.chip,
              mode === next ? styles.chipSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`channel-proof-${next}`}
          >
            <Text selectable style={styles.chipLabel}>
              {next}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  proof: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  proofSource: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  proofRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  chip: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  chipSelected: { backgroundColor: mobileColors.navigationSelected },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  pressed: { opacity: 0.76 },
});
