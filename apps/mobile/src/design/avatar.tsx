import { Image, StyleSheet, Text, View } from "react-native";
import { mobileColors } from "./tokens";

export function MobileAvatar({
  name,
  size = 40,
  uri,
  livePlatform,
  testID,
}: {
  readonly name: string;
  readonly size?: number;
  readonly uri?: string | null;
  readonly livePlatform?: "twitch" | "kick" | null;
  readonly testID?: string;
}) {
  const live = livePlatform != null;
  const content = (
    <>
      <Text
        accessible={false}
        style={[styles.initial, { fontSize: size * 0.4 }]}
      >
        {name.trim().slice(0, 1).toUpperCase()}
      </Text>
      {uri ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </>
  );
  return (
    <View
      accessibilityLabel={name}
      accessibilityRole="image"
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        live
          ? { borderColor: mobileColors[livePlatform], borderWidth: 2 }
          : null,
      ]}
      testID={testID}
    >
      {live ? (
        <View
          style={[
            styles.liveGap,
            { width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 },
          ]}
        >
          <View
            style={[
              styles.liveImage,
              {
                width: size - 8,
                height: size - 8,
                borderRadius: (size - 8) / 2,
              },
            ]}
          >
            {content}
          </View>
        </View>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { color: mobileColors.textPrimary, fontWeight: "600" },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  liveGap: {
    alignItems: "center",
    backgroundColor: mobileColors.background,
    justifyContent: "center",
    overflow: "hidden",
  },
  liveImage: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    justifyContent: "center",
    overflow: "hidden",
  },
});
