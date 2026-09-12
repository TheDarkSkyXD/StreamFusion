export const BROADCAST_LANGUAGES = [
  "en",
  "es",
  "pt",
  "fr",
  "de",
  "ru",
  "ko",
  "ja",
  "zh",
  "it",
  "pl",
  "tr",
  "nl",
  "sv",
  "ar",
  "th",
  "cs",
  "hu",
  "fi",
  "da",
  "no",
  "el",
  "he",
  "uk",
  "vi",
  "id",
] as const;

export type BroadcastLanguage = (typeof BROADCAST_LANGUAGES)[number];

export type LanguageFilter = "all" | BroadcastLanguage;

export function isBroadcastLanguage(value: string): value is BroadcastLanguage {
  return BROADCAST_LANGUAGES.some((language) => language === value);
}

export function parseLanguageFilter(value: string | null): LanguageFilter {
  if (value === null || value === "" || value === "all") return "all";
  return isBroadcastLanguage(value) ? value : "all";
}
