import { nativeText, type NativeCopyKey } from "@shared/i18n/native-copy.generated";

import { storageService } from "./storage-service";

export function getNativeText(
  key: NativeCopyKey,
  values?: Readonly<Record<string, string | number>>
): string {
  return nativeText(storageService.getPreferences().language, key, values);
}
