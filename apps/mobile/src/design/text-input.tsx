import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "./tokens";

export function MobileTextField({
  disabled = false,
  error,
  hint,
  label,
  multiline = false,
  onChange,
  placeholder,
  secure = false,
  value,
}: {
  readonly disabled?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly label: string;
  readonly multiline?: boolean;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly secure?: boolean;
  readonly value: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={mobileType.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...(error || hint ? { accessibilityHint: error ?? hint } : {})}
        editable={!disabled}
        multiline={multiline}
        onChangeText={onChange}
        {...(placeholder === undefined ? {} : { placeholder })}
        placeholderTextColor={mobileColors.textSecondary}
        secureTextEntry={secure}
        value={value}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          error ? styles.invalid : null,
          disabled ? styles.disabled : null,
        ]}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={mobileType.label}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: mobileSpacing.small },
  input: {
    backgroundColor: mobileColors.surface,
    borderWidth: 1,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    color: mobileColors.textPrimary,
    fontSize: 16,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  invalid: { borderColor: mobileColors.danger },
  error: { ...mobileType.label, color: "#ff8299" },
  disabled: { opacity: 0.5 },
});
