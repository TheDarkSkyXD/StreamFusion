import { beforeEach, describe, expect, it } from "vitest";

import type { HistoryItem } from "@/store/history-store";
import { useHistoryStore } from "@/store/history-store";

type HistoryInput = Omit<HistoryItem, "timestamp">;

function makeItem(overrides: Partial<HistoryInput> = {}): HistoryInput {
  return {
    id: "kick-video-v1",
    originalId: "v1",
    title: "Test VOD",
    thumbnail: "https://example.com/thumb.jpg",
    platform: "kick",
    type: "video",
    channelName: "xqc",
    ...overrides,
  };
}

beforeEach(() => {
  useHistoryStore.setState({ history: [] });
});

describe("history-store addToHistory", () => {
  it("adds an item with a timestamp", () => {
    useHistoryStore.getState().addToHistory(makeItem());
    const items = useHistoryStore.getState().history;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test VOD");
    expect(items[0].timestamp).toBeGreaterThan(0);
  });

  it("bumps a duplicate id to the top instead of creating a second entry", () => {
    useHistoryStore.getState().addToHistory(makeItem({ id: "a", title: "first" }));
    useHistoryStore.getState().addToHistory(makeItem({ id: "b", title: "second" }));
    useHistoryStore.getState().addToHistory(makeItem({ id: "a", title: "first-updated" }));
    const items = useHistoryStore.getState().history;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("a");
    expect(items[0].title).toBe("first-updated");
  });

  it("caps at 200 items", () => {
    for (let i = 0; i < 210; i++) {
      useHistoryStore.getState().addToHistory(makeItem({ id: `item-${i}` }));
    }
    expect(useHistoryStore.getState().history).toHaveLength(200);
  });

  it("newest item is at index 0", () => {
    useHistoryStore.getState().addToHistory(makeItem({ id: "old" }));
    useHistoryStore.getState().addToHistory(makeItem({ id: "new" }));
    expect(useHistoryStore.getState().history[0].id).toBe("new");
  });
});

describe("history-store removeFromHistory", () => {
  it("removes the item with the given id", () => {
    useHistoryStore.getState().addToHistory(makeItem({ id: "a" }));
    useHistoryStore.getState().addToHistory(makeItem({ id: "b" }));
    useHistoryStore.getState().removeFromHistory("a");
    expect(useHistoryStore.getState().history.map((i) => i.id)).toEqual(["b"]);
  });

  it("is a no-op when the id does not exist", () => {
    useHistoryStore.getState().addToHistory(makeItem({ id: "a" }));
    useHistoryStore.getState().removeFromHistory("nope");
    expect(useHistoryStore.getState().history).toHaveLength(1);
  });
});

describe("history-store clearHistory", () => {
  it("empties the history array", () => {
    useHistoryStore.getState().addToHistory(makeItem({ id: "a" }));
    useHistoryStore.getState().addToHistory(makeItem({ id: "b" }));
    useHistoryStore.getState().clearHistory();
    expect(useHistoryStore.getState().history).toEqual([]);
  });
});
