import { useEffect, useState } from "react";

function readMediaQuery(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMediaQuery(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
}
