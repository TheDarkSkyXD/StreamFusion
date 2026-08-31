import { useCallback, useState } from "react";

export function useMentionAutocomplete() {
  const [isActive, setIsActive] = useState(false);

  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => setIsActive(false), []);
  const checkTrigger = useCallback((value: string, cursorPos: number) => {
    for (let index = cursorPos - 1; index >= 0; index -= 1) {
      const character = value[index];
      if (/\s/.test(character)) {
        setIsActive(false);
        return;
      }
      if (character === "@") {
        setIsActive(true);
        return;
      }
    }
    setIsActive(false);
  }, []);

  return { isActive, activate, deactivate, checkTrigger };
}
