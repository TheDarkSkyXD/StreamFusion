import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { CatalogCategory } from "../domain/category-identity";

const viewerFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CategoryCard({
  category,
  onPress,
}: {
  readonly category: CatalogCategory;
  readonly onPress: () => void;
}) {
  const { t } = useTranslation();
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
      <Text numberOfLines={2} selectable style={styles.name}>
        {category.name}
      </Text>
      {category.viewerCount !== undefined ? (
        <Text selectable style={styles.viewers}>
          {t("discovery.viewers", {
            count: category.viewerCount,
            formattedCount: viewerFormatter.format(category.viewerCount),
          })}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: mobileSpacing.xSmall,
    width: "48%",
  },
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
  name: mobileType.title,
  viewers: {
    ...mobileType.label,
    color: mobileColors.textSecondary,
  },
  pressed: { opacity: 0.76 },
});
