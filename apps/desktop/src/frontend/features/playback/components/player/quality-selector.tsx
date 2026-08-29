import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";

import type { QualityLevel } from "./types";

export interface QualitySelectorProps {
  levels: QualityLevel[];
  current: string;
  onChange: (qualityId: string) => void;
  disabled?: boolean;
}

export function QualitySelector({ levels, current, onChange, disabled }: QualitySelectorProps) {
  if (!levels || levels.length === 0) return null;

  return (
    <div className="relative inline-block z-50">
      <Select value={current} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="gap-2 h-7 min-w-[70px] bg-black/60 border-white/10 text-white text-[11px] hover:bg-black/80 focus:ring-0 backdrop-blur-sm">
          <SelectValue placeholder="Qual" />
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
              {level.label}
              {!level.isAuto && level.bitrate > 0 && ` (${Math.round(level.bitrate / 1000)}k)`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
