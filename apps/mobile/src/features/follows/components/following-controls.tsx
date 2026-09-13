import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { FollowingChip, FollowingTab } from "../capabilities/following-session";

const TABS: readonly FollowingTab[] = [
  "live",
  "videos",
  "clips",
  "categories",
  "channels",
];
const CHIPS: readonly FollowingChip[] = ["all", "live", "twitch", "kick"];

export function FollowingControls({
  chip,
  onChip,
  onQuery,
  onTab,
  query,
  tab,
}: {
  readonly chip: FollowingChip;
  readonly onChip: (chip: FollowingChip) => void;
  readonly onQuery: (query: string) => void;
  readonly onTab: (tab: FollowingTab) => void;
  readonly query: string;
  readonly tab: FollowingTab;
}) {
  return (
    <View style={styles.stack}>
      <TextInput
        accessibilityLabel="Search Guest Follows"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onQuery}
        placeholder="Search Guest Follows"
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.search}
        testID="following-search"
        value={query}
      />
      <View style={styles.row}>
        {CHIPS.map((value) => (
          <Pressable
            accessibilityLabel={`${value} filter`}
            accessibilityRole="button"
            accessibilityState={{ selected: chip === value }}
            key={value}
            onPress={() => onChip(value)}
            style={[styles.chip, chip === value ? styles.selected : null]}
            testID={`following-chip-${value}`}
          >
            <Text selectable style={styles.chipLabel}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        {TABS.map((value) => (
          <Pressable
            accessibilityLabel={`${value} tab`}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === value }}
            key={value}
            onPress={() => onTab(value)}
            style={[styles.chip, tab === value ? styles.selected : null]}
            testID={`following-tab-${value}`}
          >
            <Text selectable style={styles.chipLabel}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small },
  search: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  chip: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  selected: { backgroundColor: mobileColors.navigationSelected },
  chipLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
