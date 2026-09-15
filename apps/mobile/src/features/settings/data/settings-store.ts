import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import {
  parseProductPreferences,
  serializeProductPreferences,
  type ProductPreferences,
} from "@streamfusion/core/settings";

import { PRODUCT_SETTINGS_KEY } from "../capabilities/settings";

export function createProductPreferenceStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<ProductPreferences>;
  write(value: ProductPreferences): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    async read() {
      return parseProductPreferences(await input.settings.read(PRODUCT_SETTINGS_KEY));
    },
    write(value) {
      return input.settings.write(
        PRODUCT_SETTINGS_KEY,
        serializeProductPreferences(value),
        now(),
      );
    },
  };
}
