import { WifiOff } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export type MobileConnectivityStatus = "online" | "offline" | "checking";

/**
 * Shell-level connectivity banner. Visible across tabs when offline/degraded.
 * Keeps browseable UI available — does not block navigation.
 */
export function MobileConnectivityBanner({
  status,
}: {
  readonly status: MobileConnectivityStatus;
}) {
  if (status === "online") return null;
  const checking = status === "checking";
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      style={styles.card}
      testID="connectivity-banner"
    >
      <View style={styles.iconWrap} accessibilityElementsHidden>
        <WifiOff color={mobileColors.textCategory} size={18} strokeWidth={2} />
      </View>
      <View style={styles.copy}>
        <Text selectable style={styles.title}>
          You are offline
        </Text>
        <Text selectable style={styles.body}>
          Saved content stays available. Live reads and playback need a
          connection.
        </Text>
        {checking ? (
          <Text selectable style={styles.meta} testID="connectivity-banner-checking">
            Checking connection…
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    marginHorizontal: mobileSpacing.medium,
    marginTop: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    height: mobileSizing.minimumTouchTarget - 8,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget - 8,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    minWidth: 0,
  },
  title: {
    ...mobileType.title,
    fontSize: 14,
    lineHeight: 18,
  },
  body: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    ...mobileType.label,
    color: mobileColors.textSecondary,
    marginTop: mobileSpacing.xSmall,
  },
});
