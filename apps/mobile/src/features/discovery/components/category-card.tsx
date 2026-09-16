import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { MobileCatalogTags } from "@mobile/design/tag";
import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
  mobileSpacing,
  mobileType,
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
      <View style={styles.tags}>
        <MobileCatalogTags tags={category.tags} />
      </View>
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
    ...mobilePressRing.rest,
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
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
    ...mobileType.title,
    paddingHorizontal: mobileSpacing.small,
    paddingTop: mobileSpacing.small,
  },
  tags: {
    paddingHorizontal: mobileSpacing.small,
  },
  viewers: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    padding: mobileSpacing.small,
  },
  pressed: {
    ...mobilePressRing.pressed,
  },
});
