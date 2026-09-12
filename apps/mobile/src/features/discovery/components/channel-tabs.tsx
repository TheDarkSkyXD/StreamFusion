import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
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
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === next }}
          android_ripple={{ color: mobileColors.surfaceRaised }}
          key={next}
          onPress={() => onSelect(next)}
          style={({ pressed }) => [
            styles.tab,
            tab === next ? styles.selected : null,
            pressed ? styles.pressed : null,
          ]}
          testID={`channel-tab-${next}`}
        >
          <Text selectable style={styles.label}>
            {tabLabel(next)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function tabLabel(tab: ChannelDetailTab): string {
  if (tab === "home") return "Home";
  if (tab === "videos") return "Videos";
  return "Clips";
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  tab: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  selected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  label: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.76,
  },
});
