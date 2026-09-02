import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";

import type { QualityLevel } from "./types";
import { useTranslation } from "react-i18next";

export interface QualitySelectorProps {
  levels: QualityLevel[];
  current: string;
  onChange: (qualityId: string) => void;
  disabled?: boolean;
}

function formatBitrateLabel(bitrate: number): string {
  return ` (${Math.round(bitrate / 1000)}k)`;
}

export function QualitySelector({ levels, current, onChange, disabled }: QualitySelectorProps) {
  const { t } = useTranslation();
  if (!levels || levels.length === 0) return null;

  return (
    <div className="relative inline-block z-50">
      <Select value={current} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="gap-2 h-7 min-w-[70px] bg-black/60 border-white/10 text-white text-[11px] hover:bg-black/80 focus:ring-0 backdrop-blur-sm">
          <SelectValue placeholder={t("playback.qual")} />
        </SelectTrigger>
        <SelectContent
          side="top"
          align="end"
          className="bg-[#1a1b1e] border-[#2c2e33] text-white max-h-[300px] z-[60]"
        >
          {levels.map((level) => (
            <SelectItem
              key={level.id}
              value={level.id}
              className="text-xs cursor-pointer focus:bg-[#2c2e33] focus:text-white"
            >
              {level.isAuto
                ? t("playback.auto")
                : level.isSource
                  ? t("playback.sourceQuality")
                  : level.label}
              {!level.isAuto && level.bitrate > 0 && formatBitrateLabel(level.bitrate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
