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

// Constructing Intl.DisplayNames is non-trivial; build it once at module load.
const displayNames = new Intl.DisplayNames(["en"], { type: "language" });

export function getLanguageDisplayName(code: string): string {
  return displayNames.of(code) || code;
}
