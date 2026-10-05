import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileChoiceGroup<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly label: string; readonly value: T }[];
  readonly value: T;
}) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={styles.group}
    >
      <Text style={mobileType.label}>{label}</Text>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityLabel={option.label}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option.value }}
          aria-checked={value === option.value}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [
            styles.option,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.radio}>
            {value === option.value ? <View style={styles.dot} /> : null}
          </View>
          <Text style={styles.label}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: mobileSpacing.small },
  option: {
    minHeight: mobileSizing.minimumTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.medium,
    paddingHorizontal: mobileSpacing.medium,
    borderRadius: mobileRadii.medium,
  },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
  radio: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: mobileColors.textSecondary,
    borderRadius: mobileRadii.full,
    justifyContent: "center",
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: mobileRadii.full,
    backgroundColor: mobileColors.textPrimary,
  },
  label: { ...mobileType.body, color: mobileColors.textPrimary },
});
