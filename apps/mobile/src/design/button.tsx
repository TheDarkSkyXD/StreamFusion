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
  busy = false,
  disabled = false,
  onPress,
  testID,
  variant,
  children,
}: {
  readonly accessibilityHint?: string;
  readonly accessibilityLabel: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  readonly variant: MobileButtonVariant;
  readonly children: string;
}) {
  const look = variantLook(variant);
  const inactive = disabled || busy;
  return (
    <Pressable
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: inactive }}
      android_ripple={{ color: mobileColors.surfaceRaised }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        look.container,
        pressed && !inactive ? pressedLook(variant) : null,
        inactive ? styles.disabled : null,
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

function pressedLook(variant: MobileButtonVariant): ViewStyle {
  switch (variant) {
    case "secondary":
      return { backgroundColor: mobileColors.surfaceRaised };
    case "ghost":
    case "outline":
      return { backgroundColor: mobileColors.surface };
    default:
      return { opacity: 0.9 };
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
  disabled: {
    opacity: 0.5,
  },
});
