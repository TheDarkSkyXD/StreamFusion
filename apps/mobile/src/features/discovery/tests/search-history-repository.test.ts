import { describe, expect, it } from "vitest";

import { createSearchHistoryRepository } from "../composition/search-history-repository";
import { addSearchHistory, emptySearchHistory } from "../domain/search-history";

describe("search history repository", () => {
  it("persists scoped queries and recovers from damaged JSON", async () => {
    let stored: string | null = null;
    const repository = createSearchHistoryRepository({
      async read() {
        return stored;
      },
      async write(value) {
        stored = value;
      },
    });
    const history = addSearchHistory(emptySearchHistory(), "channels", "arcade");
    await repository.write(history, 1);
    await expect(repository.read()).resolves.toEqual(history);
    stored = "{not-json";
    await expect(repository.read()).resolves.toEqual(emptySearchHistory());
  });
});
