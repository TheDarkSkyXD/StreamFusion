import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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

function SettingsRow({
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  children,
  onPress,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly accessibilityRole: "button" | "switch";
  readonly accessibilityState?: { readonly checked: boolean };
  readonly children: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <Text selectable style={styles.rowLabel}>
        {children}
      </Text>
    </Pressable>
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
    <SettingsRow
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      onPress={onToggle}
      testID={testID}
    >
      {`${label}: ${checked ? "on" : "off"}`}
    </SettingsRow>
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
        {options.map((option) => {
          const value = String(option);
          return (
            <Pressable
              key={value}
              accessibilityLabel={`${label} ${value}`}
              accessibilityRole="button"
              onPress={() => onSelect(option)}
              style={styles.choice}
              testID={`${testID}-${value}`}
            >
              <Text selectable style={styles.choiceLabel}>
                {current === option ? `Selected ${value}` : value}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SettingsAction({
  label,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <SettingsRow
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
    >
      {label}
    </SettingsRow>
  );
}

export function SettingsField({
  label,
  onChangeText,
  testID,
  value,
}: {
  readonly label: string;
  readonly onChangeText: (value: string) => void;
  readonly testID: string;
  readonly value: string;
}) {
  return (
    <View style={styles.choiceBlock} testID={testID}>
      <Text selectable style={styles.rowLabel}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        multiline
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={mobileColors.textSecondary}
        style={styles.field}
        value={value}
      />
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
  field: {
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    color: mobileColors.textPrimary,
    fontSize: 16,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
});
