import { useCallback, useState } from "react";

export interface ContextualEmoteMatch {
  query: string;
  startPos: number;
  endPos: number;
  explicit: boolean;
}

export function getContextualEmoteMatch(
  inputValue: string,
  cursorPosition: number
): ContextualEmoteMatch | null {
  if (cursorPosition <= 0) return null;
  if (/\s/.test(inputValue[cursorPosition - 1])) return null;
  let startPos = cursorPosition - 1;
  while (startPos > 0 && !/\s/.test(inputValue[startPos - 1])) startPos -= 1;
  const token = inputValue.slice(startPos, cursorPosition);
  const explicit = token.startsWith(":");
  const query = explicit ? token.slice(1) : token;
  if (query.length < 1) return null;
  return { query, startPos, endPos: cursorPosition, explicit };
}

export function useContextualEmoteMode() {
  const [isActive, setIsActive] = useState(false);
  const deactivate = useCallback(() => setIsActive(false), []);
  const checkTrigger = useCallback((value: string, cursorPosition: number, _triggerChar = ":") => {
    setIsActive(getContextualEmoteMatch(value, cursorPosition) !== null);
  }, []);
  return { isActive, deactivate, checkTrigger };
}
