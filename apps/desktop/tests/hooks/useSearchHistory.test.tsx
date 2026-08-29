import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useSearchHistory } from "@/features/discovery/data/useSearchHistory";

const STORAGE_KEY = "streamfusion_search_history";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// Guards: search history persists independently for channels, categories, and streams while migrating the old flat localStorage format into channels only.
describe("useSearchHistory", () => {
  it("starts with an empty history when localStorage has no entry", () => {
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("loads existing scoped history from localStorage on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        channels: ["foo", "bar"],
        categories: ["Just Chatting"],
        streams: ["live now"],
      })
    );
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual(["foo", "bar"]);
    expect(result.current.historyByScope.categories).toEqual(["Just Chatting"]);
    expect(result.current.historyByScope.streams).toEqual(["live now"]);
  });

  it("migrates legacy flat history into channels only", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["foo", "bar"]));
    const { result } = renderHook(() => useSearchHistory("categories"));
    expect(result.current.history).toEqual([]);
    expect(result.current.historyByScope.channels).toEqual(["foo", "bar"]);
    expect(result.current.historyByScope.categories).toEqual([]);
    expect(result.current.historyByScope.streams).toEqual([]);
  });

  it("addSearch prepends a new term and persists to localStorage", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch("test"));
    expect(result.current.history).toEqual(["test"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      channels: ["test"],
      categories: [],
      streams: [],
    });
  });

  it("addSearch can target a different tab", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch("Elden Ring", "categories"));
    expect(result.current.history).toEqual([]);
    expect(result.current.historyByScope.categories).toEqual(["Elden Ring"]);
  });

  it("addSearch deduplicates (case-insensitive) and bumps to top", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch("Foo"));
    act(() => result.current.addSearch("bar"));
    act(() => result.current.addSearch("foo"));
    expect(result.current.history).toEqual(["foo", "bar"]);
  });

  it("addSearch ignores empty/whitespace-only terms", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch(""));
    act(() => result.current.addSearch("   "));
    expect(result.current.history).toEqual([]);
  });

  it("addSearch caps at 10 items", () => {
    const { result } = renderHook(() => useSearchHistory());
    for (let i = 0; i < 15; i++) {
      act(() => result.current.addSearch(`term${i}`));
    }
    expect(result.current.history).toHaveLength(10);
    expect(result.current.history[0]).toBe("term14");
  });

  it("removeSearch removes an exact match", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch("a"));
    act(() => result.current.addSearch("b"));
    act(() => result.current.removeSearch("a"));
    expect(result.current.history).toEqual(["b"]);
  });

  it("clearHistory empties the selected tab and persists to localStorage", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch("a"));
    act(() => result.current.clearHistory());
    expect(result.current.history).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      channels: [],
      categories: [],
      streams: [],
    });
  });

  it("clearHistory only clears the selected tab", () => {
    const { result } = renderHook(() => useSearchHistory("streams"));
    act(() => result.current.addSearch("live", "streams"));
    act(() => result.current.addSearch("channel", "channels"));
    act(() => result.current.clearHistory());
    expect(result.current.historyByScope.streams).toEqual([]);
    expect(result.current.historyByScope.channels).toEqual(["channel"]);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{");
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });
});
