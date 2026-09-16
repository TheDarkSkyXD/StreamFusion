import { Pressable, StyleSheet, Text } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "./tokens";

export function MobileFilterChip({
  accessibilityLabel,
  accessibilityRole = "button",
  label,
  onPress,
  selected,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: "button" | "tab";
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected }}
      android_ripple={{ color: mobileColors.tagSurfaceHover }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : null,
        pressed && !selected ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <Text
        selectable
        style={selected ? styles.labelSelected : styles.label}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    backgroundColor: mobileColors.tagSurface,
    borderRadius: mobileRadii.full,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.xSmall,
  },
  selected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  pressed: {
    backgroundColor: mobileColors.tagSurfaceHover,
  },
  label: {
    color: mobileColors.tagText,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  labelSelected: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    lineHeight: 16,
  },
});
