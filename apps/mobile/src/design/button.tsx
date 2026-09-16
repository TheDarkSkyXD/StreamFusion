import { Pressable, StyleSheet, Text, type TextStyle, type ViewStyle } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export const mobileButtonVariants = [
  "primary",
  "secondary",
  "ghost",
  "outline",
  "twitch",
  "kick",
  "destructive",
] as const;

export type MobileButtonVariant = (typeof mobileButtonVariants)[number];

export function MobileButton({
  accessibilityHint,
  accessibilityLabel,
  disabled = false,
  onPress,
  testID,
  variant,
  children,
}: {
  readonly accessibilityHint?: string;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  readonly variant: MobileButtonVariant;
  readonly children: string;
}) {
  const look = variantLook(variant);
  return (
    <Pressable
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={{ color: mobileColors.surfaceRaised }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        look.container,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <Text selectable style={[styles.label, look.label]}>
        {children}
      </Text>
    </Pressable>
  );
}

function variantLook(variant: MobileButtonVariant): {
  readonly container: ViewStyle;
  readonly label: TextStyle;
} {
  switch (variant) {
    case "primary":
      return {
        container: { backgroundColor: mobileColors.textPrimary },
        label: { color: mobileColors.background },
      };
    case "secondary":
      return {
        container: { backgroundColor: mobileColors.surfaceMuted },
        label: { color: mobileColors.textPrimary },
      };
    case "ghost":
      return {
        container: { backgroundColor: "transparent" },
        label: { color: mobileColors.textPrimary },
      };
    case "outline":
      return {
        container: {
          backgroundColor: "transparent",
          borderColor: mobileColors.border,
          borderWidth: 1,
        },
        label: { color: mobileColors.textPrimary },
      };
    case "twitch":
      return {
        container: { backgroundColor: mobileColors.twitch },
        label: { color: mobileColors.textPrimary },
      };
    case "kick":
      return {
        container: { backgroundColor: mobileColors.kick },
        label: { color: mobileColors.background },
      };
    case "destructive":
      return {
        container: { backgroundColor: mobileColors.danger },
        label: { color: mobileColors.textPrimary },
      };
  }
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  label: {
    fontSize: mobileType.title.fontSize,
    fontWeight: "700",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.5,
  },
});
