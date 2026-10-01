import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { mobileColors, mobileRadii, mobileSpacing } from "./tokens";

export function MobilePlatformBadge({
  platform,
  style,
  variant = "label",
}: {
  readonly platform: "twitch" | "kick";
  readonly style?: StyleProp<ViewStyle>;
  readonly variant?: "label" | "icon";
}) {
  const kick = platform === "kick";
  return (
    <View
      accessibilityLabel={kick ? "Kick" : "Twitch"}
      style={[
        variant === "icon" ? styles.iconBadge : styles.badge,
        ...(variant === "icon" ? [] : [kick ? styles.kick : styles.twitch]),
        ...(style === undefined ? [] : [style]),
      ]}
    >
      {variant === "icon" ? (
        <Svg height={16} viewBox="0 0 24 24" width={16}>
          <Path
            d={
              kick
                ? "M9 3a1 1 0 0 1 1 1v3h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h6a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-1v1a1 1 0 0 1 -.883 .993l-.117 .007h-1v2h1a1 1 0 0 1 .993 .883l.007 .117v1h1a1 1 0 0 1 .993 .883l.007 .117v4a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1h-1a1 1 0 0 1 -.993 -.883l-.007 -.117v-1h-1v3a1 1 0 0 1 -.883 .993l-.117 .007h-5a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z"
                : "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
            }
            fill={kick ? mobileColors.kick : mobileColors.twitch}
          />
        </Svg>
      ) : (
        <Text selectable style={kick ? styles.kickLabel : styles.twitchLabel}>
          {kick ? "KICK" : "TWITCH"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  iconBadge: {
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: mobileRadii.medium,
    padding: 6,
  },
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
