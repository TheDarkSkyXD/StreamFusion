import { i18n } from "@/i18n";
import type { settingsEn } from "@/i18n/locales/en/settings";

type SettingsTranslationKey = `settings.${keyof typeof settingsEn.settings}`;

function interpolate({
  translated,
  options,
}: {
  translated: string;
  options?: Record<string, unknown>;
}): string {
  return options
    ? Object.entries(options).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
        translated
      )
    : translated;
}

export function translateSettings({
  key,
  options,
}: {
  key: SettingsTranslationKey;
  options?: Record<string, unknown>;
}): string {
  return interpolate({ translated: String(i18n.t(key)), options });
}

export function translateSettingsForLanguage({
  key,
  language,
  options,
}: {
  key: SettingsTranslationKey;
  language: string;
  options?: Record<string, unknown>;
}): string {
  return interpolate({ translated: String(i18n.getFixedT(language)(key)), options });
}
