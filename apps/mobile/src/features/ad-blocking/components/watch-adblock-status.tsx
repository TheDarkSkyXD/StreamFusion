import { StyleSheet, Text, View } from "react-native";

import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { AdBlockView } from "../capabilities/ad-blocking";
import type { Platform } from "@streamfusion/core/platform";

export function WatchAdBlockStatus({
  compact = false,
  platform,
  view,
}: {
  readonly compact?: boolean;
  readonly platform: Platform;
  readonly view: AdBlockView | null;
}) {
  const detail = statusDetail(platform, view);
  const title = view?.title ?? "Playback filtering";
  if (compact) {
    return (
      <View
        accessibilityLabel={`${title}. ${detail}`}
        style={styles.chip}
        testID="watch-adblock-status"
      >
        <Text numberOfLines={1} selectable style={styles.chipLabel}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <MobileStatusPanel testID="watch-adblock-status" tone="info">
      <Text selectable style={mobileType.title}>
        {title}
      </Text>
      <Text selectable style={mobileType.body}>
        {detail}
      </Text>
    </MobileStatusPanel>
  );
}

function statusDetail(platform: Platform, view: AdBlockView | null): string {
  if (!view) return "Reading playback filtering.";
  if (platform === "kick") {
    return "Kick has no approved filter. This Watch session is unfiltered.";
  }
  return view.detail;
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.full,
    borderWidth: 1,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.xSmall,
  },
  chipLabel: {
    ...mobileType.label,
    color: mobileColors.textSecondary,
  },
});
