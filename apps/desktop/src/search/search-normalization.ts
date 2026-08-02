const SEARCH_GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });
const WORD_GRAPHEME_PATTERN = /^[\p{L}\p{N}]+$/u;
const EMOJI_GRAPHEME_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function normalizeSearchTokens(query: string): string[] {
  const normalized = query.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const uniqueTokens = new Set<string>();
  let word = "";
  const flushWord = () => {
    if (word) uniqueTokens.add(word);
    word = "";
  };

  for (const { segment } of SEARCH_GRAPHEME_SEGMENTER.segment(normalized)) {
    if (WORD_GRAPHEME_PATTERN.test(segment)) {
      word += segment;
      continue;
    }
    flushWord();
    if (EMOJI_GRAPHEME_PATTERN.test(segment)) uniqueTokens.add(segment);
  }
  flushWord();
  return Array.from(uniqueTokens);
}

export function normalizeSearchQuery(query: string): string {
  return normalizeSearchTokens(query).join(" ");
}
