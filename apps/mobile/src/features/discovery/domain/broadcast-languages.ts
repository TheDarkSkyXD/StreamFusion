import {
  BROADCAST_LANGUAGES,
  isBroadcastLanguage,
  parseLanguageFilter,
  type BroadcastLanguage,
  type LanguageFilter,
} from "../utils/broadcast-languages";

export {
  BROADCAST_LANGUAGES,
  isBroadcastLanguage,
  parseLanguageFilter,
  type BroadcastLanguage,
  type LanguageFilter,
};

const LANGUAGE_LABELS: Readonly<Record<BroadcastLanguage, string>> = {
  ar: "Arabic",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  he: "Hebrew",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ru: "Russian",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
};

export function languageLabel(filter: LanguageFilter): string {
  if (filter === "all") return "All languages";
  return LANGUAGE_LABELS[filter];
}
