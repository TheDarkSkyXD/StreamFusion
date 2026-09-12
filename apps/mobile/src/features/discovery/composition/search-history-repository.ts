import type { SearchHistoryStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  SearchHistoryByScope,
  SearchHistoryRepository,
} from "../capabilities/platform-reads";
import {
  emptySearchHistory,
  parseSearchHistory,
} from "../domain/search-history";

export function createSearchHistoryRepository(
  store: SearchHistoryStore,
): SearchHistoryRepository {
  return {
    async read() {
      const value = await store.read();
      if (value === null) return emptySearchHistory();
      try {
        return parseSearchHistory(JSON.parse(value));
      } catch {
        return emptySearchHistory();
      }
    },
    async write(history: SearchHistoryByScope, updatedAt: number) {
      await store.write(JSON.stringify(history), updatedAt);
    },
  };
}
