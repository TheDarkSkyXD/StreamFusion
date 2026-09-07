import { nativeText, type NativeCopyKey } from "@shared/i18n/native-copy.generated";

import { preferencesRepository } from "@backend/features/settings/data/preferences-repository";

export function getNativeText(
  key: NativeCopyKey,
  values?: Readonly<Record<string, string | number>>
): string {
  return nativeText(preferencesRepository.getPreferences().language, key, values);
}
