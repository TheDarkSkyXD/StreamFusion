import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

const TABS = [
  "all",
  "channels",
  "streams",
  "videos",
  "clips",
  "categories",
] as const satisfies readonly SearchResultType[];

const PLATFORMS = ["all", "twitch", "kick"] as const;

export type SearchPlatformFilter = "all" | Platform;

export function SearchFilters({
  liveOnly,
  onSelectPlatform,
  onSelectTab,
  onToggleLiveOnly,
  platform,
  tab,
}: {
  readonly liveOnly: boolean;
  readonly onSelectPlatform: (platform: SearchPlatformFilter) => void;
  readonly onSelectTab: (tab: SearchResultType) => void;
  readonly onToggleLiveOnly: () => void;
  readonly platform: SearchPlatformFilter;
  readonly tab: SearchResultType;
}) {
  return (
    <View style={styles.stack}>
      <View
        accessibilityLabel="Search result types"
        accessibilityRole="tablist"
        style={styles.row}
      >
        {TABS.map((next) => (
          <Pressable
            accessibilityLabel={tabLabel(next)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === next }}
            android_ripple={{ color: mobileColors.surfaceRaised }}
            key={next}
            onPress={() => onSelectTab(next)}
            style={({ pressed }) => [
              styles.chip,
              tab === next ? styles.chipSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`search-tab-${next}`}
          >
            <Text selectable style={styles.chipLabel}>
              {tabLabel(next)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View accessibilityLabel="Search filters" style={styles.row}>
        {PLATFORMS.map((next) => (
          <Pressable
            accessibilityLabel={
              next === "all" ? "All platforms" : platformLabel(next)
            }
            accessibilityRole="button"
            accessibilityState={{ selected: platform === next }}
            key={next}
            onPress={() => onSelectPlatform(next)}
            style={({ pressed }) => [
              styles.chip,
              platform === next ? styles.chipSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`search-platform-${next}`}
          >
            <Text selectable style={styles.chipLabel}>
              {next === "all" ? "All platforms" : platformLabel(next)}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel="Live only"
          accessibilityRole="button"
          accessibilityState={{ selected: liveOnly }}
          onPress={onToggleLiveOnly}
          style={({ pressed }) => [
            styles.chip,
            liveOnly ? styles.chipSelected : null,
            pressed ? styles.pressed : null,
          ]}
          testID="toggle-live-only"
        >
          <Text selectable style={styles.chipLabel}>
            Live only
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function tabLabel(tab: SearchResultType): string {
  switch (tab) {
    case "all":
      return "All";
    case "channels":
      return "Channels";
    case "streams":
      return "Streams";
    case "videos":
      return "Videos";
    case "clips":
      return "Clips";
    case "categories":
      return "Categories";
  }
}

function platformLabel(platform: Platform): string {
  return platform === "twitch" ? "Twitch" : "Kick";
}

const styles = StyleSheet.create({
  stack: {
    gap: mobileSpacing.small,
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
