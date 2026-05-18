/**
 * TimeoutDurationPicker
 *
 * Six preset duration chips for the timeout mod-action. AE3 of the
 * channel-management console plan requires exactly six chips and explicitly
 * forbids a custom-duration input.
 *
 * Default selection is 10 minutes — Twitch's own default in the native UI —
 * and the component fires `onChange(600)` on mount so the parent dialog has
 * a value ready without requiring an explicit click.
 */

import { useEffect, useState } from "react";

interface DurationPreset {
  label: string;
  seconds: number;
}

const DURATION_PRESETS: DurationPreset[] = [
  { label: "10s", seconds: 10 },
  { label: "1m", seconds: 60 },
  { label: "10m", seconds: 600 },
  { label: "30m", seconds: 1800 },
  { label: "24h", seconds: 86_400 },
  { label: "7d", seconds: 604_800 },
];

const DEFAULT_SECONDS = 600; // 10m — matches Twitch's native default.

export interface TimeoutDurationPickerProps {
  disabled: boolean;
  /** Lifts the chosen duration in seconds to the parent dialog. */
  onChange: (durationSeconds: number) => void;
}

export function TimeoutDurationPicker({
  disabled,
  onChange,
}: TimeoutDurationPickerProps) {
  const [selected, setSelected] = useState<number>(DEFAULT_SECONDS);

  // Push the default up to the parent on first render so a confirm without
  // any click still produces `{ durationSeconds: 600 }`.
  useEffect(() => {
    onChange(DEFAULT_SECONDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = (seconds: number) => {
    setSelected(seconds);
    onChange(seconds);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-[#EFEFF1] mb-2">
        Duration
      </legend>
      <div className="flex flex-wrap gap-2" data-testid="timeout-duration-chips">
        {DURATION_PRESETS.map((preset) => {
          const isSelected = preset.seconds === selected;
          return (
            <button
              key={preset.seconds}
              type="button"
              onClick={() => handlePick(preset.seconds)}
              disabled={disabled}
              data-selected={isSelected ? "true" : "false"}
              className={
                "rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
                (isSelected
                  ? "bg-[#9146FF] text-white"
                  : "bg-white/5 hover:bg-white/10 text-[#EFEFF1]")
              }
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
