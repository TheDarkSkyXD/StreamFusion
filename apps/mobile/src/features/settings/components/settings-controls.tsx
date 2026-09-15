import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

export function SettingsSection({
  children,
  testID,
  title,
}: {
  readonly children: ReactNode;
  readonly testID: string;
  readonly title: string;
}) {
  return (
    <View style={styles.panel} testID={testID}>
      <Text selectable style={styles.kicker}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function SettingsCopy({
  testID,
  value,
}: {
  readonly testID: string;
  readonly value: string;
}) {
  return (
    <Text selectable style={styles.detail} testID={testID}>
      {value}
    </Text>
  );
}

export function SettingsSwitch({
  checked,
  label,
  onToggle,
  testID,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={styles.row}
      testID={testID}
    >
      <Text selectable style={styles.rowLabel}>
        {checked ? `${label}: on` : `${label}: off`}
      </Text>
    </Pressable>
  );
}

export function SettingsChoiceRow<T extends string | number>({
  current,
  label,
  onSelect,
  options,
  testID,
}: {
  readonly current: T;
  readonly label: string;
  readonly onSelect: (value: T) => void;
  readonly options: readonly T[];
  readonly testID: string;
}) {
  return (
    <View style={styles.choiceBlock} testID={testID}>
      <Text selectable style={styles.rowLabel}>
        {label}: {String(current)}
      </Text>
      <View style={styles.choiceRow}>
        {options.map((option) => (
          <Pressable
            key={String(option)}
            accessibilityLabel={`${label} ${String(option)}`}
            accessibilityRole="button"
            onPress={() => onSelect(option)}
            style={styles.choice}
            testID={`${testID}-${String(option)}`}
          >
            <Text selectable style={styles.choiceLabel}>
              {current === option ? `Selected ${String(option)}` : String(option)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  kicker: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  row: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  rowLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  choiceBlock: {
    gap: mobileSpacing.small,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  choice: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  choiceLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
});
