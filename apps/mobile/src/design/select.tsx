import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronDown } from "lucide-react-native";

import { selectionHaptic } from "./haptics";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "./tokens";

export type MobileSelectOption<T extends string> = {
  readonly label: string;
  readonly value: T;
};

export function MobileSelect<T extends string>({
  accessibilityLabel,
  disabled = false,
  onChange,
  options,
  testID,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
  readonly options: readonly MobileSelectOption<T>[];
  readonly testID: string;
  readonly value: T;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;

  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          disabled ? styles.triggerDisabled : null,
          pressed && !disabled ? styles.triggerPressed : null,
        ]}
        testID={`${testID}-trigger`}
      >
        <Text selectable style={styles.triggerLabel} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <ChevronDown color={mobileColors.textSecondary} size={18} />
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel={`Dismiss ${accessibilityLabel}`}
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
            testID={`${testID}-dismiss`}
          />
          <View
            accessibilityLabel={accessibilityLabel}
            style={styles.sheet}
            testID={`${testID}-menu`}
          >
            <View style={styles.sheetHandle} />
            <Text selectable style={styles.menuTitle}>
              {accessibilityLabel}
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.menuScroll}
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
                      selectable
                      style={[
                        styles.optionLabel,
                        active ? styles.optionLabelActive : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {active ? (
                      <Text selectable style={styles.optionCheck}>
                        Selected
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
  },
  trigger: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
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
  triggerDisabled: {
    opacity: 0.45,
  },
  triggerPressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  triggerLabel: {
    color: mobileColors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  backdrop: {
    backgroundColor: mobileColors.overlay,
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderTopLeftRadius: mobileRadii.large,
    borderTopRightRadius: mobileRadii.large,
    borderTopWidth: 1,
    maxHeight: "70%",
    paddingBottom: mobileSpacing.large,
    paddingTop: mobileSpacing.small,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: mobileColors.border,
    borderRadius: 999,
    height: 4,
    marginBottom: mobileSpacing.small,
    width: 36,
  },
  menuTitle: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    lineHeight: 16,
    paddingBottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
  },
  menuScroll: {
    flexGrow: 0,
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
  optionCheck: {
    color: mobileColors.twitchBright,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
});
