import { Image, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import kickVerifiedBadge from "./assets/kick-verified.png";

export function MobileVerifiedBadge({
  platform,
}: {
  readonly platform: "twitch" | "kick";
}) {
  const label = platform === "kick" ? "Verified on Kick" : "Verified on Twitch";
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="image"
      style={styles.badge}
      testID={`verified-badge-${platform}`}
    >
      {platform === "kick" ? (
        <Image
          accessibilityIgnoresInvertColors
          source={kickVerifiedBadge}
          style={styles.image}
        />
      ) : (
        <Svg height={16} viewBox="0 0 16 16" width={16}>
          <Path
            d="M8 1.25 9.58 3l2.31-.49.73 2.24 2.13 1.01-.86 2.19.86 2.19-2.13 1.01-.73 2.24-2.31-.49L8 14.65 6.42 12.9l-2.31.49-.73-2.24-2.13-1.01.86-2.19-.86-2.19 2.13-1.01.73-2.24L6.42 3 8 1.25Z"
            fill="#9146FF"
          />
          <Path
            d="m6.95 10.26-2.1-2.1.88-.88 1.22 1.22 3.32-3.32.88.88-4.2 4.2Z"
            fill="#FFFFFF"
          />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 16,
    width: 16,
  },
  image: {
    height: 16,
    width: 16,
  },
});
