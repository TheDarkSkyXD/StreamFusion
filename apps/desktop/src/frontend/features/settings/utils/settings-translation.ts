import { i18n } from "@/i18n";
import type { settingsEn } from "@/i18n/locales/en/settings";

type SettingsTranslationKey = `settings.${keyof typeof settingsEn.settings}`;

export function translateSettings(
  key: SettingsTranslationKey,
  options?: Record<string, unknown>,
  language?: string
): string {
  const translated = String(language ? i18n.getFixedT(language)(key) : i18n.t(key));
  return options
    ? Object.entries(options).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
        translated
      )
    : translated;
}
