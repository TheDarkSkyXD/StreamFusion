import { StyleSheet, TextInput, View } from "react-native";

import { MobileFilterChip } from "@mobile/design/chip";
import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import {
  mobileTextFieldProps,
  mobileTextFieldStyle,
} from "@mobile/design/text-field";
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
        {...mobileTextFieldProps}
        accessibilityLabel="Search Guest Follows"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onQuery}
        placeholder="Search Guest Follows"
        placeholderTextColor={mobileColors.textMuted}
        style={styles.search}
        testID="following-search"
        value={query}
      />
      <View accessibilityLabel="Following filters" style={styles.row}>
        {CHIPS.map((value) => (
          <MobileFilterChip
            accessibilityLabel={chipLabel(value)}
            key={value}
            label={chipLabel(value)}
            onPress={() => onChip(value)}
            selected={chip === value}
            testID={`following-chip-${value}`}
          />
        ))}
      </View>
      <MobileUnderlineTabs
        accessibilityLabel="Following content"
        onSelect={onTab}
        selectedId={tab}
        tabs={TABS.map((value) => ({
          accessibilityLabel: tabLabel(value),
          id: value,
          label: tabLabel(value),
          testID: `following-tab-${value}`,
        }))}
        testID="following-content-tabs"
      />
    </View>
  );
}

function chipLabel(chip: FollowingChip): string {
  switch (chip) {
    case "all":
      return "All";
    case "live":
      return "Live only";
    case "twitch":
      return "Twitch";
    case "kick":
      return "Kick";
  }
}

function tabLabel(tab: FollowingTab): string {
  switch (tab) {
    case "live":
      return "Live";
    case "videos":
      return "Videos";
    case "clips":
      return "Clips";
    case "categories":
      return "Categories";
    case "channels":
      return "Channels";
  }
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small },
  search: {
    ...mobileTextFieldStyle,
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
});
