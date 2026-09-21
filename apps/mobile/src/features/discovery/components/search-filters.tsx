import { ScrollView, StyleSheet, View } from "react-native";
import type { SearchResultType } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import { MobileFilterChip } from "@mobile/design/chip";
import { mobileSpacing } from "@mobile/design/tokens";

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
      <ScrollView
        accessibilityLabel="Search result types"
        accessibilityRole="tablist"
        contentContainerStyle={styles.row}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {TABS.map((next) => (
          <MobileFilterChip
            accessibilityLabel={tabLabel(next)}
            accessibilityRole="tab"
            key={next}
            label={tabLabel(next)}
            onPress={() => onSelectTab(next)}
            selected={tab === next}
            testID={`search-tab-${next}`}
          />
        ))}
      </ScrollView>
      <View accessibilityLabel="Search filters" style={styles.row}>
        {PLATFORMS.map((next) => (
          <MobileFilterChip
            accessibilityLabel={
              next === "all" ? "All platforms" : platformLabel(next)
            }
            key={next}
            label={next === "all" ? "All platforms" : platformLabel(next)}
            onPress={() => onSelectPlatform(next)}
            selected={platform === next}
            testID={`search-platform-${next}`}
          />
        ))}
        <MobileFilterChip
          accessibilityLabel="Live only"
          label="Live only"
          onPress={onToggleLiveOnly}
          selected={liveOnly}
          testID="toggle-live-only"
        />
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
});
