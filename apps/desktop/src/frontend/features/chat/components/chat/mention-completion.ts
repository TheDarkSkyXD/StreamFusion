export interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

const USERNAME_CHARACTER = /[A-Za-z0-9_]/;

export function getMentionRange(value: string, cursorPosition: number): MentionRange | null {
  if (cursorPosition < 1 || cursorPosition > value.length) return null;

  let mentionStart = cursorPosition - 1;
  while (mentionStart >= 0 && USERNAME_CHARACTER.test(value[mentionStart])) {
    mentionStart -= 1;
  }
  if (value[mentionStart] !== "@") return null;
  if (mentionStart > 0 && !/\s/.test(value[mentionStart - 1])) return null;

  let mentionEnd = cursorPosition;
  while (mentionEnd < value.length && USERNAME_CHARACTER.test(value[mentionEnd])) {
    mentionEnd += 1;
  }

  return {
    start: mentionStart,
    end: mentionEnd,
    query: value.slice(mentionStart + 1, cursorPosition),
  };
}
