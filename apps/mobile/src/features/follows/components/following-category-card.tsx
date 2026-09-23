import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Category } from "@streamfusion/core/content";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobilePressRing,
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
      <View style={styles.copy}>
        <Text selectable style={styles.title}>
          {category.name}
        </Text>
        <Text selectable style={styles.meta}>
          {viewersLabel}
        </Text>
        <MobilePlatformBadge platform={category.platform} />
      </View>
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
    ...mobilePressRing.rest,
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    overflow: "hidden",
    padding: mobileSpacing.medium,
  },
  pressed: {
    ...mobilePressRing.pressed,
  },
  artWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.small,
    overflow: "hidden",
    width: 72,
  },
  art: { height: "100%", width: "100%" },
  artFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.xSmall,
  },
  fallbackLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    justifyContent: "center",
  },
  title: {
    ...mobileType.title,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
