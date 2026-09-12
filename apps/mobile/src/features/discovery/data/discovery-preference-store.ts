import type { ClipTimeRange } from "@streamfusion/core/discovery";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import {
  CLIP_TIME_SETTING_KEY,
  LANGUAGE_SETTING_KEY,
} from "../capabilities/discovery-preferences";
import {
  parseLanguageFilter,
  type LanguageFilter,
} from "../domain/broadcast-languages";

export function createDiscoveryPreferenceStore(input: {
  readonly now?: () => number;
  readonly readSetting: (key: string) => Promise<string | null>;
  readonly writeSetting: (input: {
    readonly key: string;
    readonly updatedAt: number;
    readonly value: string;
  }) => Promise<void>;
}): DiscoveryPreferenceStore {
  const now = input.now ?? Date.now;
  return {
    async readLanguage() {
      return parseLanguageFilter(await input.readSetting(LANGUAGE_SETTING_KEY));
    },
    async writeLanguage(value: LanguageFilter) {
      await input.writeSetting({
        key: LANGUAGE_SETTING_KEY,
        updatedAt: now(),
        value,
      });
    },
    async readClipTimeRange() {
      return parseClipTimeRange(await input.readSetting(CLIP_TIME_SETTING_KEY));
    },
    async writeClipTimeRange(value: ClipTimeRange) {
      await input.writeSetting({
        key: CLIP_TIME_SETTING_KEY,
        updatedAt: now(),
        value,
      });
    },
  };
}

function parseClipTimeRange(value: string | null): ClipTimeRange {
  return value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "all"
    ? value
    : "all";
}
