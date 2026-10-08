import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileListRow({
  description,
  destructive = false,
  disabled = false,
  hint,
  leading,
  onPress,
  title,
  testID,
  trailing,
}: {
  readonly description?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly leading?: ReactNode;
  readonly onPress?: () => void;
  readonly title: string;
  readonly testID?: string;
  readonly trailing?: ReactNode;
}) {
  const content = (
    <>
      {leading}
      <View style={styles.copy}>
        <Text
          style={[
            mobileType.body,
            styles.title,
            destructive ? styles.danger : null,
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <ChevronRight color={mobileColors.textSecondary} size={20} />
        ) : null)}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={description ? `${title}, ${description}` : title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.row} testID={testID}>
      {content}
    </View>
  );
}

export function MobileSwitchRow({
  description,
  disabled = false,
  onChange,
  title,
  testID,
  value,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
  readonly title: string;
  readonly testID?: string;
  readonly value: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <View style={styles.copy} accessible={false}>
        <Text style={[mobileType.body, styles.title]}>{title}</Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      <Switch
        accessibilityElementsHidden
        importantForAccessibility="no"
        pointerEvents="none"
        disabled={disabled}
        onValueChange={onChange}
        value={value}
        thumbColor={value ? "#121214" : mobileColors.textPrimary}
        trackColor={{
          false: "#18181b",
          true: "#e4e4e7",
        }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingVertical: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    borderRadius: mobileRadii.medium,
  },
  copy: { flex: 1, gap: mobileSpacing.xSmall, minWidth: 0 },
  title: { color: mobileColors.textPrimary },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: mobileColors.textSecondary,
  },
  danger: { color: "#ff8299" },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
  disabled: { opacity: 0.5 },
});
