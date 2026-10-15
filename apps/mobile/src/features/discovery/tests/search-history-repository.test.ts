import { describe, expect, it } from "vitest";

import { createSearchHistoryRepository } from "../composition/search-history-repository";
import {
  addSearchHistory,
  emptySearchHistory,
  removeSearchHistory,
} from "../domain/search-history";

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
    const history = addSearchHistory(
      addSearchHistory(
        addSearchHistory(
          addSearchHistory(emptySearchHistory(), "all", "all query"),
          "channels",
          "channel query",
        ),
        "streams",
        "stream query",
      ),
      "categories",
      "category query",
    );
    await repository.write(history, 1);
    await expect(repository.read()).resolves.toEqual(history);
    await repository.write(removeSearchHistory(history, "all", "all query"), 2);
    await expect(repository.read()).resolves.toEqual({
      all: [],
      channels: [{ label: "channel query" }],
      streams: [{ label: "stream query" }],
      categories: [{ label: "category query" }],
    });
    stored = "{not-json";
    await expect(repository.read()).resolves.toEqual(emptySearchHistory());
  });
});
