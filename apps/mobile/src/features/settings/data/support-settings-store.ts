import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import type { SupportSettingsStore } from "../capabilities/support-settings";
import { SUPPORT_SETTINGS_KEY } from "../capabilities/support-settings";
import {
  DEFAULT_SUPPORT_SETTINGS,
  parseSupportSettings,
} from "../capabilities/parse-support-settings";

export function createSupportPreferenceStore(
  settings: ProductSettingsStore,
): SupportSettingsStore {
  return {
    async read() {
      const raw = await settings.read(SUPPORT_SETTINGS_KEY);
      return raw ? parseSupportSettings(raw) : DEFAULT_SUPPORT_SETTINGS;
    },
    async write(value: unknown) {
      const preferences = parseSupportSettings(value);
      await settings.write(
        SUPPORT_SETTINGS_KEY,
        JSON.stringify(preferences),
        Date.now(),
      );
      return preferences;
    },
  };
}
