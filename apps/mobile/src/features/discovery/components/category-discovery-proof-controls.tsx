import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { DiscoveryFixtureMode } from "../capabilities/platform-reads";

const PROOF_MODES = [
  "live",
  "ready",
  "loading",
  "stale-cache",
  "cache-miss",
  "twitch-fail",
  "kick-fail",
  "auth-lost",
  "cancelled",
  "relay-unavailable",
  "retry-exhausted",
] as const satisfies readonly DiscoveryFixtureMode[];

export const D07_PROOF_TOKEN = "D07 category discovery proof";

export function CategoryDiscoveryProofControls({
  mode,
  onSelect,
}: {
  readonly mode: DiscoveryFixtureMode;
  readonly onSelect: (mode: DiscoveryFixtureMode) => void;
}) {
  return (
    <View style={styles.panel} testID="category-discovery-proof-controls">
      <Text selectable style={styles.label}>
        DEVELOPMENT CATEGORY DISCOVERY
      </Text>
      <Text selectable style={styles.source} testID="category-proof-source">
        {D07_PROOF_TOKEN}
      </Text>
      <View style={styles.row}>
        {PROOF_MODES.map((next) => (
          <Pressable
            accessibilityLabel={`Inject ${next} category state`}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === next }}
            key={next}
            onPress={() => onSelect(next)}
            style={[
              styles.chip,
              mode === next ? styles.chipSelected : null,
            ]}
            testID={`category-proof-${next}`}
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
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
  },
  source: {
    color: mobileColors.textSecondary,
    fontSize: 12,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  chip: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  chipSelected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
});
