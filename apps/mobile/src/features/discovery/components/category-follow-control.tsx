import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { CategoryFollowState } from "../domain/category-identity";

export function CategoryFollowControl({
  follow,
}: {
  readonly follow: CategoryFollowState;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityHint="Category Follow needs a signed-in provider account"
        accessibilityLabel="Follow category"
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        disabled
        style={styles.button}
        testID="category-follow"
      >
        <Text selectable style={styles.label}>
          Follow
        </Text>
      </Pressable>
      <Text selectable style={styles.reason} testID="category-follow-reason">
        {follow.reason === "guest-category-follow-requires-account"
          ? "Category Follow needs a signed-in provider account. Guest Follows are for channels, not categories."
          : follow.reason}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: mobileSpacing.small,
  },
  button: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    opacity: 0.64,
    paddingHorizontal: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  reason: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
});
