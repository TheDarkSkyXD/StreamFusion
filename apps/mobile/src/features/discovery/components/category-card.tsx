import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { CatalogCategory } from "../domain/category-identity";

export function CategoryCard({
  category,
  onPress,
}: {
  readonly category: CatalogCategory;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens category detail"
      accessibilityLabel={category.name}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`category-card-${category.platform}-${category.id}`}
    >
      <View style={styles.artWrap}>
        {category.boxArtUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: category.boxArtUrl }}
            style={styles.art}
          />
        ) : (
          <View style={styles.artFallback}>
            <Text selectable style={styles.fallbackLabel}>
              {category.name}
            </Text>
          </View>
        )}
      </View>
      <Text selectable style={styles.name}>
        {category.name}
      </Text>
      <Text selectable style={styles.viewers}>
        {category.viewerCount === undefined
          ? "Viewers unavailable"
          : `${category.viewerCount} viewers`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
    width: "47%",
  },
  artWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  art: {
    height: "100%",
    width: "100%",
  },
  artFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.small,
  },
  fallbackLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  name: {
    color: mobileColors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    paddingHorizontal: mobileSpacing.small,
    paddingTop: mobileSpacing.small,
  },
  viewers: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    padding: mobileSpacing.small,
  },
  pressed: {
    opacity: 0.76,
  },
});
