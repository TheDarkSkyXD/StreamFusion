import { describe, expect, it } from "vitest";

import {
  addSearchHistory,
  channelIdentityFromHistory,
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
    expect(history.channels[0]).toEqual({ label: "query-12" });
    expect(history.channels.some((item) => item.label === "query-1")).toBe(false);
    history = addSearchHistory(history, "channels", "QUERY-11");
    expect(history.channels[0]).toEqual({ label: "QUERY-11" });
    expect(
      history.channels.filter((item) => item.label.toLowerCase() === "query-11"),
    ).toHaveLength(1);
  });

  it("removes and clears only the requested scope", () => {
    const history = addSearchHistory(
      addSearchHistory(emptySearchHistory(), "streams", "live"),
      "categories",
      "fps",
    );
    expect(removeSearchHistory(history, "streams", "live").streams).toEqual([]);
    expect(removeSearchHistory(history, "streams", "live").categories).toEqual([
      { label: "fps" },
    ]);
    expect(clearSearchHistory(history, "categories").categories).toEqual([]);
    expect(clearSearchHistory(history, "categories").streams).toEqual([
      { label: "live" },
    ]);
  });

  it("parses scoped lists, rich channel entries, and maps tabs to history scopes", () => {
    expect(
      parseSearchHistory({
        channels: [
          "  apex  ",
          "",
          1,
          {
            label: "Pokimane",
            avatarUrl: "https://example.com/a.png",
            channelId: "123",
            platform: "twitch",
            username: "pokimane",
          },
        ],
        extra: ["no"],
      }),
    ).toEqual({
      categories: [],
      channels: [
        { label: "apex" },
        {
          label: "Pokimane",
          avatarUrl: "https://example.com/a.png",
          channelId: "123",
          platform: "twitch",
          username: "pokimane",
        },
      ],
      streams: [],
    });
    expect(
      channelIdentityFromHistory({
        label: "Pokimane",
        channelId: "123",
        platform: "twitch",
        username: "pokimane",
      }),
    ).toEqual({
      id: "123",
      platform: "twitch",
      username: "pokimane",
    });
    expect(historyScopeForTab("streams")).toBe("streams");
    expect(historyScopeForTab("categories")).toBe("categories");
    expect(historyScopeForTab("videos")).toBe("channels");
    expect(historyScopeForTab("all")).toBe("channels");
  });
});
