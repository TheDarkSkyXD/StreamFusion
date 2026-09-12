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

const englishNames = new Intl.DisplayNames(["en"], { type: "language" });

export function languageLabel(filter: LanguageFilter): string {
  if (filter === "all") return "All languages";
  return englishNames.of(filter) ?? filter;
}
