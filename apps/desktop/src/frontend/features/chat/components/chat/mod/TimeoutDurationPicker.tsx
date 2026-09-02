import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TimeoutActionPolicy } from "@shared/timeout-moderation-types";

interface DurationPreset {
  labelKey:
    | "chatModeration.duration10Seconds"
    | "chatModeration.duration1Minute"
    | "chatModeration.duration10Minutes"
    | "chatModeration.duration30Minutes"
    | "chatModeration.duration24Hours"
    | "chatModeration.duration7Days";
  seconds: number;
}

const DURATION_PRESETS: DurationPreset[] = [
  { labelKey: "chatModeration.duration10Seconds", seconds: 10 },
  { labelKey: "chatModeration.duration1Minute", seconds: 60 },
  { labelKey: "chatModeration.duration10Minutes", seconds: 600 },
  { labelKey: "chatModeration.duration30Minutes", seconds: 1_800 },
  { labelKey: "chatModeration.duration24Hours", seconds: 86_400 },
  { labelKey: "chatModeration.duration7Days", seconds: 604_800 },
];

const TWITCH_POLICY: TimeoutActionPolicy = {
  durationUnit: "seconds",
  minDuration: 1,
  maxDuration: 1_209_600,
  supportsReason: true,
  maxReasonLength: 500,
};

export interface TimeoutDurationPickerProps {
  disabled: boolean;
  policy?: TimeoutActionPolicy;
  /** Reports the value in `policy.durationUnit`. */
  onChange: (duration: number) => void;
  onValidationChange?: (valid: boolean) => void;
}

function toNativeDuration(
  seconds: number,
  unit: TimeoutActionPolicy["durationUnit"]
): number | null {
  if (unit === "seconds") return seconds;
  return seconds % 60 === 0 ? seconds / 60 : null;
}

function parseCustomDuration(raw: string, policy: TimeoutActionPolicy): number | null {
  const value = Number(raw);
  return raw.trim().length > 0 &&
    Number.isInteger(value) &&
    value >= policy.minDuration &&
    value <= policy.maxDuration
    ? value
    : null;
}

export function TimeoutDurationPicker({
  disabled,
  policy = TWITCH_POLICY,
  onChange,
  onValidationChange,
}: TimeoutDurationPickerProps) {
  const { t } = useTranslation();
  const durationUnit = t(
    policy.durationUnit === "seconds" ? "chatModeration.seconds" : "chatModeration.minutes"
  );
  const validationMessage = () =>
    t("chatModeration.durationValidation", {
      min: policy.minDuration,
      max: policy.maxDuration,
      unit: durationUnit,
    });
  const presets = useMemo(
    () =>
      DURATION_PRESETS.flatMap((preset) => {
        const value = toNativeDuration(preset.seconds, policy.durationUnit);
        return value !== null && value >= policy.minDuration && value <= policy.maxDuration
          ? [{ ...preset, value }]
          : [];
      }),
    [policy.durationUnit, policy.maxDuration, policy.minDuration]
  );
  const preferred = presets.find((preset) => preset.seconds === 600) ?? presets[0];
  const [selected, setSelected] = useState<number | "custom">(() => preferred?.value ?? "custom");
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // A new verified Platform policy represents a fresh confirmation snapshot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callbacks are intentionally excluded so a parent render cannot reset the operator's choice
  useEffect(() => {
    const nextDefault = preferred?.value ?? policy.minDuration;
    setSelected(preferred ? nextDefault : "custom");
    setCustomValue(preferred ? "" : String(nextDefault));
    setCustomError(null);
    onChange(nextDefault);
    onValidationChange?.(true);
  }, [
    onChange,
    onValidationChange,
    policy.durationUnit,
    policy.maxDuration,
    policy.minDuration,
    preferred,
  ]);

  const selectPreset = (value: number) => {
    setSelected(value);
    setCustomError(null);
    onValidationChange?.(true);
    onChange(value);
  };

  const selectCustom = () => {
    setSelected("custom");
    const parsed = parseCustomDuration(customValue, policy);
    const valid = parsed !== null;
    setCustomError(valid ? null : validationMessage());
    onValidationChange?.(valid);
    if (parsed !== null) onChange(parsed);
  };

  const updateCustom = (raw: string) => {
    setCustomValue(raw);
    const value = parseCustomDuration(raw, policy);
    const valid = value !== null;
    setCustomError(valid ? null : validationMessage());
    onValidationChange?.(valid);
    if (value !== null) onChange(value);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-[#EFEFF1]">
        {t("chatModeration.duration")}
      </legend>
      <div className="flex flex-wrap gap-2" data-testid="timeout-duration-chips">
        {presets.map((preset) => {
          const isSelected = preset.value === selected;
          return (
            <button
              key={preset.labelKey}
              type="button"
              onClick={() => selectPreset(preset.value)}
              disabled={disabled}
              data-selected={isSelected ? "true" : "false"}
              className={
                "rounded-full px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                (isSelected
                  ? "bg-[#9146FF] text-white"
                  : "bg-white/5 text-[#EFEFF1] hover:bg-white/10")
              }
            >
              {t(preset.labelKey)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={selectCustom}
          disabled={disabled}
          data-selected={selected === "custom" ? "true" : "false"}
          className={
            "rounded-full px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
            (selected === "custom"
              ? "bg-[#9146FF] text-white"
              : "bg-white/5 text-[#EFEFF1] hover:bg-white/10")
          }
        >
          {t("chatModeration.custom")}
        </button>
      </div>
      {selected === "custom" ? (
        <div className="pt-1">
          <label
            htmlFor="timeout-custom-duration"
            className="mb-1 block text-xs text-[var(--color-foreground-muted)]"
          >
            {t("chatModeration.customDuration", { unit: durationUnit })}
          </label>
          <input
            id="timeout-custom-duration"
            type="number"
            inputMode="numeric"
            step={1}
            min={policy.minDuration}
            max={policy.maxDuration}
            value={customValue}
            disabled={disabled}
            aria-label={t("chatModeration.customDurationAria", { unit: durationUnit })}
            aria-invalid={customError ? "true" : "false"}
            aria-describedby={customError ? "timeout-custom-duration-error" : undefined}
            onChange={(event) => updateCustom(event.target.value)}
            className="h-9 w-full rounded-md border border-white/15 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#9146FF] disabled:opacity-50"
          />
          {customError ? (
            <p id="timeout-custom-duration-error" className="mt-1 text-xs text-red-300">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
