import type { ClipTimeRange } from "@streamfusion/core/discovery";

import type { LanguageFilter } from "../utils/broadcast-languages";

export interface DiscoveryPreferenceStore {
  readLanguage(): Promise<LanguageFilter>;
  writeLanguage(value: LanguageFilter): Promise<void>;
  readClipTimeRange(): Promise<ClipTimeRange>;
  writeClipTimeRange(value: ClipTimeRange): Promise<void>;
}

export const LANGUAGE_SETTING_KEY = "discovery:category-language";
export const CLIP_TIME_SETTING_KEY = "discovery:clips-filter-preference";
