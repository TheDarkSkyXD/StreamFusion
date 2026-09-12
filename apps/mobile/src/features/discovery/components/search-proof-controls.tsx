import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { DiscoveryFixtureMode } from "../capabilities/platform-reads";

export const SEARCH_PROOF_SOURCE = "issue-149-d06-ab06";

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

export function SearchProofControls({
  mode,
  onSelect,
}: {
  readonly mode: DiscoveryFixtureMode;
  readonly onSelect: (mode: DiscoveryFixtureMode) => void;
}) {
  return (
    <View style={styles.panel} testID="search-discovery-proof-controls">
      <Text selectable style={styles.label}>
        DEVELOPMENT SEARCH READS
      </Text>
      <Text selectable style={styles.source} testID="search-proof-source">
        {SEARCH_PROOF_SOURCE}
      </Text>
      <View style={styles.row}>
        {PROOF_MODES.map((next) => (
          <Pressable
            accessibilityLabel={`Inject ${next} search state`}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === next }}
            android_ripple={{ color: mobileColors.surfaceRaised }}
            key={next}
            onPress={() => onSelect(next)}
            style={({ pressed }) => [
              styles.chip,
              mode === next ? styles.chipSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`search-proof-${next}`}
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
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  source: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  row: {
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
  chipSelected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.76,
  },
});
