export const DISPLAY_LANGUAGE_REGISTRY = [
  { code: "en", nativeLabel: "English", englishLabel: "English", direction: "ltr" },
  { code: "es", nativeLabel: "Español", englishLabel: "Spanish", direction: "ltr" },
] as const;

export type DisplayLanguage = (typeof DISPLAY_LANGUAGE_REGISTRY)[number]["code"];
export type DisplayLanguageDefinition = (typeof DISPLAY_LANGUAGE_REGISTRY)[number];
