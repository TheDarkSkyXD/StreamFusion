import { View } from "react-native";

import { MobileFilterChip } from "@mobile/design/chip";
import { mobileSpacing } from "@mobile/design/tokens";
import type { ChannelDetailTab } from "../capabilities/platform-reads";

const TABS: readonly ChannelDetailTab[] = ["home", "videos", "clips"];

export function ChannelTabs({
  onSelect,
  tab,
}: {
  readonly onSelect: (tab: ChannelDetailTab) => void;
  readonly tab: ChannelDetailTab;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.row} testID="channel-tabs">
      {TABS.map((next) => (
        <MobileFilterChip
          accessibilityLabel={tabLabel(next)}
          accessibilityRole="tab"
          key={next}
          label={tabLabel(next)}
          onPress={() => onSelect(next)}
          selected={tab === next}
          testID={`channel-tab-${next}`}
        />
      ))}
    </View>
  );
}

function tabLabel(tab: ChannelDetailTab): string {
  if (tab === "home") return "Home";
  if (tab === "videos") return "Videos";
  return "Clips";
}

const styles = {
  row: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: mobileSpacing.small,
  },
};
