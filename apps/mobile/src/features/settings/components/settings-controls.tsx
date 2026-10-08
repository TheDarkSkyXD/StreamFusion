import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { selectionHaptic } from "@mobile/design/haptics";
import { MobileListRow, MobileSwitchRow } from "@mobile/design/list-row";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileSelect, type MobileSelectOption } from "@mobile/design/select";

import {
  DISPLAY_LANGUAGE_REGISTRY,
  type DisplayLanguage,
} from "@streamfusion/core/display-language";

import {
  mobileColors,
  mobileRadii,
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
  detail,
  disabled = false,
  label,
  onToggle,
  testID,
}: {
  readonly checked: boolean;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testID: string;
}) {
  return (
    <MobileSwitchRow
      {...(detail === undefined ? {} : { description: detail })}
      disabled={disabled}
      onChange={onToggle}
      testID={testID}
      title={label}
      value={checked}
    />
  );
}

export type SettingsSelectOption<T extends string | number> = {
  readonly label: string;
  readonly value: T;
  /** Closed-row trailing label; defaults to `label` (native names for languages). */
  readonly valueLabel?: string;
};

/**
 * Frosty / Categories-style discrete picker: settings row shows title + current
 * value + chevron; tap opens the shared MobileSelect bottom sheet.
 */
export function SettingsSelect<T extends string | number>({
  current,
  detail,
  disabled = false,
  label,
  onSelect,
  options,
  testID,
}: {
  readonly current: T;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onSelect: (value: T) => void;
  readonly options: readonly SettingsSelectOption<T>[];
  readonly testID: string;
}) {
  const stringOptions: readonly MobileSelectOption<string>[] = options.map(
    (option) => ({
      label: option.label,
      value: String(option.value),
      ...(option.valueLabel ? { valueLabel: option.valueLabel } : {}),
    }),
  );
  return (
    <View testID={testID}>
      <MobileSelect
        accessibilityLabel={label}
        appearance="row"
        {...(detail === undefined ? {} : { description: detail })}
        disabled={disabled}
        onChange={(next) => {
          const match = options.find((option) => String(option.value) === next);
          if (match) onSelect(match.value);
        }}
        options={stringOptions}
        testID={`${testID}-picker`}
        value={String(current)}
      />
    </View>
  );
}

/** @deprecated Prefer SettingsSelect — kept as a thin labeled wrapper for call sites migrating. */
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
    <SettingsSelect
      current={current}
      label={label}
      onSelect={onSelect}
      options={options.map((value) => ({ label: String(value), value }))}
      testID={testID}
    />
  );
}

export function SettingsLanguagePicker({
  current,
  label = "Language",
  onSelect,
  testID = "language",
}: {
  readonly current: DisplayLanguage;
  readonly label?: string;
  readonly onSelect: (language: DisplayLanguage) => void;
  readonly testID?: string;
}) {
  return (
    <SettingsSelect
      current={current}
      label={label}
      onSelect={onSelect}
      options={DISPLAY_LANGUAGE_REGISTRY.map((language) => ({
        // Sheet keeps English in parentheses for discoverability; row shows native only.
        label:
          language.nativeLabel === language.englishLabel
            ? language.nativeLabel
            : `${language.nativeLabel} (${language.englishLabel})`,
        value: language.code,
        valueLabel: language.nativeLabel,
      }))}
      testID={testID}
    />
  );
}

export function SettingsAction({
  disabled = false,
  label,
  onPress,
  testID,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <MobileListRow
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      title={label}
    />
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
      <MobileTextField
        label={label}
        multiline
        onChange={onChangeText}
        placeholder={label}
        testID={`${testID}-input`}
        value={value}
      />
    </View>
  );
}

export function SettingsSlider({
  detail,
  disabled = false,
  formatValue = defaultSliderFormat,
  label,
  max,
  min,
  onValueChange,
  step = 1,
  testID,
  value,
}: {
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly formatValue?: (value: number) => string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onValueChange: (value: number) => void;
  readonly step?: number;
  readonly testID: string;
  readonly value: number;
}) {
  const snapped = snapSliderValue(value, min, max, step);

  const handleChange = (raw: number) => {
    const next = snapSliderValue(raw, min, max, step);
    if (next !== snapped) {
      void selectionHaptic();
    }
    onValueChange(next);
  };

  return (
    <View
      accessibilityLabel={`${label} ${formatValue(snapped)}`}
      style={styles.sliderBlock}
      testID={testID}
    >
      <View style={styles.sliderHeader} accessible={false}>
        <Text selectable style={[styles.rowLabel, styles.sliderTitle]}>
          {label}
        </Text>
        <Text selectable style={styles.sliderValue}>
          {formatValue(snapped)}
        </Text>
      </View>
      {detail ? (
        <Text selectable style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      <Slider
        accessibilityLabel={label}
        disabled={disabled}
        maximumTrackTintColor={mobileColors.border}
        maximumValue={max}
        minimumTrackTintColor={mobileColors.textPrimary}
        minimumValue={min}
        onValueChange={handleChange}
        step={step}
        style={styles.slider}
        tapToSeek
        testID={`${testID}-input`}
        thumbTintColor={mobileColors.textPrimary}
        value={snapped}
      />
    </View>
  );
}

function defaultSliderFormat(value: number): string {
  return String(value);
}

function snapSliderValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  return Math.min(
    max,
    Math.max(min, min + Math.round((clamped - min) / step) * step),
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
  rowLabel: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  choiceBlock: {
    gap: mobileSpacing.small,
  },
  sliderBlock: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.xSmall,
    paddingBottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.small,
  },
  sliderHeader: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: 22,
  },
  sliderTitle: {
    flex: 1,
  },
  sliderValue: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    lineHeight: 20,
  },
  slider: {
    height: 40,
    marginHorizontal: -mobileSpacing.xSmall,
    width: "100%",
  },
});
