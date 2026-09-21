import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { mobileColors, mobileRadii, mobileSpacing } from "./tokens";

export function MobilePlatformBadge({
  platform,
  style,
}: {
  readonly platform: "twitch" | "kick";
  readonly style?: StyleProp<ViewStyle>;
}) {
  const kick = platform === "kick";
  return (
    <View
      accessibilityLabel={kick ? "Kick" : "Twitch"}
      style={[
        styles.badge,
        kick ? styles.kick : styles.twitch,
        ...(style === undefined ? [] : [style]),
      ]}
    >
      <Text selectable style={kick ? styles.kickLabel : styles.twitchLabel}>
        {kick ? "KICK" : "TWITCH"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: mobileRadii.small,
    justifyContent: "center",
    minHeight: 24,
    paddingHorizontal: mobileSpacing.small,
  },
  twitch: {
    backgroundColor: mobileColors.twitch,
  },
  kick: {
    backgroundColor: mobileColors.kick,
  },
  twitchLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  kickLabel: {
    color: mobileColors.background,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
});
