import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";

import { mobileColors, mobileRadii, mobileSizing } from "./tokens";

export function MobileIconButton({
  children,
  disabled = false,
  label,
  onPress,
  selected = false,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed || selected ? styles.active : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: mobileSizing.minimumTouchTarget,
    minHeight: mobileSizing.minimumTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: mobileRadii.medium,
  },
  active: { backgroundColor: mobileColors.surfaceRaised },
  disabled: { opacity: 0.5 },
});
