import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  AD_BLOCKING_SETTING_KEY,
  type AdBlockPreferences,
} from "../capabilities/ad-blocking";

export function createAdBlockPreferenceStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<string | null>;
  write(value: AdBlockPreferences): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    read() {
      return input.settings.read(AD_BLOCKING_SETTING_KEY);
    },
    write(value) {
      return input.settings.write(
        AD_BLOCKING_SETTING_KEY,
        JSON.stringify({
          enabled: value.enabled,
          method: value.method,
          version: 1,
        }),
        now(),
      );
    },
  };
}
