import { describe, expect, it } from "vitest";

import {
  addSearchHistory,
  clearSearchHistory,
  emptySearchHistory,
  historyScopeForTab,
  parseSearchHistory,
  removeSearchHistory,
  SEARCH_HISTORY_LIMIT,
} from "../domain/search-history";

describe("search history", () => {
  it("keeps 10 unique queries per scope and moves repeats to the front", () => {
    let history = emptySearchHistory();
    for (let index = 1; index <= 12; index += 1) {
      history = addSearchHistory(history, "channels", `query-${index}`);
    }
    expect(history.channels).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(history.channels[0]).toBe("query-12");
    expect(history.channels).not.toContain("query-1");
    history = addSearchHistory(history, "channels", "QUERY-11");
    expect(history.channels[0]).toBe("QUERY-11");
    expect(history.channels.filter((item) => item.toLowerCase() === "query-11")).toHaveLength(1);
  });

  it("removes and clears only the requested scope", () => {
    const history = addSearchHistory(
      addSearchHistory(emptySearchHistory(), "streams", "live"),
      "categories",
      "fps",
    );
    expect(removeSearchHistory(history, "streams", "live").streams).toEqual([]);
    expect(removeSearchHistory(history, "streams", "live").categories).toEqual([
      "fps",
    ]);
    expect(clearSearchHistory(history, "categories").categories).toEqual([]);
    expect(clearSearchHistory(history, "categories").streams).toEqual(["live"]);
  });

  it("parses scoped lists and maps tabs to history scopes", () => {
    expect(
      parseSearchHistory({
        channels: ["  apex  ", "", 1],
        extra: ["no"],
      }),
    ).toEqual({
      categories: [],
      channels: ["apex"],
      streams: [],
    });
    expect(historyScopeForTab("streams")).toBe("streams");
    expect(historyScopeForTab("categories")).toBe("categories");
    expect(historyScopeForTab("videos")).toBe("channels");
    expect(historyScopeForTab("all")).toBe("channels");
  });
});
