import { StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { AdBlockView } from "../capabilities/ad-blocking";
import type { Platform } from "@streamfusion/core/platform";

export function WatchAdBlockStatus({
  platform,
  view,
}: {
  readonly platform: Platform;
  readonly view: AdBlockView | null;
}) {
  const detail = statusDetail(platform, view);
  return (
    <View style={styles.banner} testID="watch-adblock-status">
      <Text selectable style={styles.title}>
        {view?.title ?? "Playback filtering"}
      </Text>
      <Text selectable style={styles.detail}>
        {detail}
      </Text>
    </View>
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
  banner: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.small,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
});
