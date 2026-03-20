import { useEffect, useState } from "react";

const STORAGE_KEY = "streamfusion_search_history";
const MAX_HISTORY_ITEMS = 10;

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([]);

  // Load history from local storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load search history:", error);
    }
  }, []);

  const saveHistory = (newHistory: string[]) => {
    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  const addSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    // Remove duplicates and keep only recent unique items
    const newHistory = [
      trimmed,
      ...history.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX_HISTORY_ITEMS);

    saveHistory(newHistory);
  };

  const removeSearch = (term: string) => {
    const newHistory = history.filter((item) => item !== term);
    saveHistory(newHistory);
  };

  const clearHistory = () => {
    saveHistory([]);
  };

  return {
    history,
    addSearch,
    removeSearch,
    clearHistory,
  };
}
