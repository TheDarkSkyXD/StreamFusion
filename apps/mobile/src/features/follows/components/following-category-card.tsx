import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Category } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

export function FollowingCategoryCard({
  category,
  onPress,
  viewersLabel,
}: {
  readonly category: Category;
  readonly onPress?: () => void;
  readonly viewersLabel: string;
}) {
  const body = (
    <>
      <View style={styles.artWrap}>
        {category.boxArtUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={{ uri: category.boxArtUrl }}
            style={styles.art}
          />
        ) : (
          <View style={styles.artFallback}>
            <Text numberOfLines={3} style={styles.fallbackLabel}>
              {category.name}
            </Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} selectable style={styles.title}>
        {category.name}
      </Text>
      <Text selectable style={styles.meta}>
        {viewersLabel}
      </Text>
    </>
  );
  const label = `${category.name} on ${category.platform}`;
  const testID = `following-category-${category.platform}-${category.id}`;
  if (!onPress) {
    return (
      <View accessibilityLabel={label} style={styles.card} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Opens category detail"
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: mobileSpacing.xSmall,
    width: "48%",
  },
  pressed: { opacity: 0.76 },
  artWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
    width: "100%",
  },
  art: { height: "100%", width: "100%" },
  artFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.small,
  },
  fallbackLabel: {
    ...mobileType.title,
    textAlign: "center",
  },
  title: mobileType.title,
  meta: {
    ...mobileType.label,
    color: mobileColors.textSecondary,
  },
});
