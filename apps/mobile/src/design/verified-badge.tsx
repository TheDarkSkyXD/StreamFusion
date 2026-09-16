import { StyleSheet, Text, View } from "react-native";

import { mobileColors } from "./tokens";

export function MobileVerifiedBadge({
  platform,
}: {
  readonly platform: "twitch" | "kick";
}) {
  const kick = platform === "kick";
  return (
    <View
      accessibilityLabel={kick ? "Verified on Kick" : "Verified on Twitch"}
      style={[styles.badge, kick ? styles.kick : styles.twitch]}
      testID={`verified-badge-${platform}`}
    >
      <Text selectable style={kick ? styles.kickMark : styles.twitchMark}>
        ✓
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    borderRadius: 999,
    height: 14,
    justifyContent: "center",
    width: 14,
  },
  twitch: {
    backgroundColor: mobileColors.twitch,
  },
  kick: {
    backgroundColor: mobileColors.kick,
  },
  twitchMark: {
    color: mobileColors.textPrimary,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
  },
  kickMark: {
    color: mobileColors.background,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
  },
});
