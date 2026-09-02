// ISO 639-1 codes for the broadcaster languages both Twitch and Kick expose
// as filter values. Ordered to match Twitch's own dropdown roughly by
// popularity; the UI re-sorts alphabetically by display name.
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

const displayNamesByLocale = new Map<string, Intl.DisplayNames>();
const englishDisplayNames = new Intl.DisplayNames(["en"], { type: "language" });
const codesByEnglishName = new Map(
  BROADCAST_LANGUAGES.map((code) => [englishDisplayNames.of(code)?.toLowerCase(), code] as const)
);

function getDisplayNames(locale: string): Intl.DisplayNames {
  const existing = displayNamesByLocale.get(locale);
  if (existing) return existing;
  const created = new Intl.DisplayNames([locale], { type: "language" });
  displayNamesByLocale.set(locale, created);
  return created;
}

export function getLanguageDisplayName(language: string, locale = "en"): string {
  const normalized = language.trim().toLowerCase();
  const code = normalized.length <= 3 ? normalized : codesByEnglishName.get(normalized);
  if (!code) return language;
  return getDisplayNames(locale).of(code) || language;
}
