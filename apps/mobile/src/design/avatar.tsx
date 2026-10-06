import { Image, StyleSheet, Text, View } from "react-native";
import { mobileColors } from "./tokens";

export function MobileAvatar({
  name,
  size = 40,
  uri,
}: {
  readonly name: string;
  readonly size?: number;
  readonly uri?: string | null;
}) {
  return (
    <View
      accessibilityLabel={name}
      accessibilityRole="image"
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text
        accessible={false}
        style={[styles.initial, { fontSize: size * 0.4 }]}
      >
        {name.trim().slice(0, 1).toUpperCase()}
      </Text>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} /> : null}
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
});
