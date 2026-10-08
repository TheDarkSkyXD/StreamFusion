import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { MobileBottomSheet } from "./bottom-sheet";

import { selectionHaptic } from "./haptics";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "./tokens";

/** Shared bottom-sheet cap for MobileSelect / SettingsSelect (half screen). */
export const mobileSelectSheetMaxHeight = mobileSizing.selectSheetMaxHeight;

export type MobileSelectOption<T extends string> = {
  readonly label: string;
  readonly value: T;
  /** Closed-trigger label; defaults to `label` (use for native language names). */
  readonly valueLabel?: string;
};

export function MobileSelect<T extends string>({
  accessibilityLabel,
  appearance = "field",
  description,
  disabled = false,
  onChange,
  options,
  testID,
  value,
}: {
  readonly accessibilityLabel: string;
  /** Row includes the label and description in one touch target; inline shows the value only. */
  readonly appearance?: "field" | "inline" | "row";
  readonly description?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
  readonly options: readonly MobileSelectOption<T>[];
  readonly testID: string;
  readonly value: T;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.valueLabel ?? selected?.label ?? value;
  const inline = appearance === "inline";
  const row = appearance === "row";

  return (
    <View style={inline ? styles.wrapInline : styles.wrap} testID={testID}>
      <Pressable
        accessibilityLabel={`${accessibilityLabel}, ${selectedLabel}`}
        accessibilityHint={description}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          row
            ? styles.triggerRow
            : inline
              ? styles.triggerInline
              : styles.trigger,
          disabled ? styles.triggerDisabled : null,
          pressed && !disabled
            ? inline
              ? styles.triggerInlinePressed
              : styles.triggerPressed
            : null,
        ]}
        testID={`${testID}-trigger`}
      >
        {row ? (
          <View accessible={false} style={styles.rowCopy}>
            <Text style={styles.rowLabel}>{accessibilityLabel}</Text>
            {description ? (
              <Text style={styles.description}>{description}</Text>
            ) : null}
          </View>
        ) : null}
        <Text
          style={[
            inline || row ? styles.triggerLabelInline : styles.triggerLabel,
            row ? styles.rowValue : null,
          ]}
          numberOfLines={row ? 2 : 1}
        >
          {selectedLabel}
        </Text>
        <ChevronDown
          color={mobileColors.textSecondary}
          size={inline || row ? 16 : 18}
        />
      </Pressable>
      <MobileBottomSheet
        onDismiss={() => setOpen(false)}
        size="selection"
        title={accessibilityLabel}
        testID={testID}
        visible={open}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              onPress={() => {
                if (option.value !== value) {
                  void selectionHaptic();
                }
                onChange(option.value);
                setOpen(false);
              }}
              style={({ pressed }) => [
                styles.option,
                active ? styles.optionActive : null,
                pressed ? styles.optionPressed : null,
              ]}
              testID={`${testID}-option-${option.value}`}
            >
              <Text
                style={[
                  styles.optionLabel,
                  active ? styles.optionLabelActive : null,
                ]}
              >
                {option.label}
              </Text>
              {active ? (
                <View
                  accessibilityLabel="Selected"
                  style={styles.selectedDot}
                />
              ) : null}
            </Pressable>
          );
        })}
      </MobileBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
  },
  wrapInline: {
    flexShrink: 1,
    maxWidth: "55%",
  },
  trigger: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceMuted,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  triggerInline: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    justifyContent: "flex-end",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingLeft: mobileSpacing.small,
  },
  triggerRow: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.medium,
  },
  rowCopy: { flex: 1, gap: mobileSpacing.xSmall, minWidth: 0 },
  rowLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  description: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  rowValue: { maxWidth: "45%" },
  triggerDisabled: {
    opacity: 0.45,
  },
  triggerPressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  triggerInlinePressed: {
    opacity: 0.7,
  },
  triggerLabel: {
    color: mobileColors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  triggerLabelInline: {
    color: mobileColors.textSecondary,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "right",
  },
  option: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  optionActive: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  optionPressed: {
    backgroundColor: mobileColors.surfaceRaised,
  },
  optionLabel: {
    color: mobileColors.textSecondary,
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
  },
  optionLabelActive: {
    color: mobileColors.textPrimary,
    fontWeight: "700",
  },
  /** Radio-style trailing marker: filled white dot only when selected (not checkmark / not accent). */
  selectedDot: {
    // Keep module-init styles on direct colors/literals so HMR cannot observe a nested token as undefined.
    backgroundColor: mobileColors.textPrimary,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
});
