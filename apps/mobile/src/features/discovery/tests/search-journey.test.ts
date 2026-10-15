// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type {
  SearchHistoryByScope,
  SearchHistoryRepository,
} from "../capabilities/platform-reads";
import {
  UnifiedSearchScreen,
  type SearchPresentationState,
} from "../components/unified-search-screen";
import { fixtureSearchOutcome } from "../domain/search-fixture";
import { emptySearchHistory } from "../domain/search-history";

type InputProps = {
  readonly onChangeText: (text: string) => void;
  readonly onSubmitEditing: (event: { nativeEvent: { text: string } }) => void;
  readonly testID: string;
  readonly value: string;
};

const inputState = vi.hoisted(() => ({ props: null as InputProps | null }));

vi.mock("react-native", () => {
  function host(props: {
    readonly accessibilityLabel?: string;
    readonly accessibilityState?: { readonly selected?: boolean };
    readonly children?: ReactNode;
    readonly onPress?: () => void;
    readonly testID?: string;
  }) {
    return createElement(
      "div",
      {
        "aria-label": props.accessibilityLabel,
        "data-selected": props.accessibilityState?.selected,
        "data-testid": props.testID,
        onClick: props.onPress,
      },
      props.children,
    );
  }
  return {
    ActivityIndicator: host,
    Image: host,
    Keyboard: { dismiss() {} },
    KeyboardAvoidingView: host,
    Pressable: host,
    RefreshControl: () => null,
    ScrollView: host,
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host,
    TextInput(props: InputProps) {
      inputState.props = props;
      return createElement("input", {
        "data-testid": props.testID,
        readOnly: true,
        value: props.value,
      });
    },
    View: host,
  };
});

vi.mock("lucide-react-native", () => ({
  ArrowLeft: () => null,
  Clock3: () => null,
  Search: () => null,
  X: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("../components/search-results-view", () => ({
  SearchResultsView: () => null,
}));

vi.mock("../components/search-provider-banner", () => ({
  SearchProviderBanner: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("search journey", () => {
  it("returns from browse and preview to the same tab with independent saved queries", async () => {
    let stored: SearchHistoryByScope = emptySearchHistory();
    const history: SearchHistoryRepository = {
      async read() {
        return stored;
      },
      async write(next) {
        stored = next;
      },
    };
    const reads: string[] = [];
    const session = {
      async search({
        platform,
        query,
      }: {
        platform: "twitch" | "kick";
        query: string;
      }) {
        reads.push(`${platform}:${query}`);
        return fixtureSearchOutcome(platform, "ready");
      },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let setPreview: (next: boolean) => void = () => undefined;
    let saved: SearchPresentationState | null = null;

    function Journey() {
      const [focused, setFocused] = useState(false);
      const [preview, setPreviewState] = useState(false);
      setPreview = setPreviewState;
      if (preview) return createElement("div", { "data-testid": "preview" });
      return createElement(UnifiedSearchScreen, {
        categoriesPanel: createElement(
          "button",
          {
            "data-testid": "categories-search-entry",
            onClick: () => setFocused(true),
          },
          "Search",
        ),
        focused,
        history,
        onOpenAccounts() {},
        onSearchFocusChange: setFocused,
        onStateChange(state) {
          saved = state;
        },
        ...(saved === null ? {} : { restoredState: saved }),
        session,
      });
    }

    const find = (id: string) =>
      container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = async (id: string) => {
      await act(async () => {
        const element = find(id);
        if (!element) throw new Error(`Missing ${id}`);
        element.click();
      });
    };
    const submit = async (query: string) => {
      await act(async () => {
        inputState.props?.onChangeText(query);
      });
      await act(async () => {
        inputState.props?.onSubmitEditing({ nativeEvent: { text: query } });
      });
    };

    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(Journey),
          ),
        );
      });
      expect(find("categories-search-entry")).not.toBeNull();
      expect(find("search-field")).toBeNull();
      expect(reads).toEqual([]);

      await click("categories-search-entry");
      expect(find("search-field")).not.toBeNull();
      expect(find("search-tab-all")).not.toBeNull();
      expect(find("search-tab-categories")).not.toBeNull();
      await submit("shroud");
      expect(reads).toEqual(["twitch:shroud", "kick:shroud"]);
      await click("clear-search-field");
      expect(find("repeat-search-shroud")).not.toBeNull();

      await click("search-tab-channels");
      expect(find("repeat-search-shroud")).toBeNull();
      await submit("arcade");
      await act(async () => setPreview(true));
      expect(find("preview")).not.toBeNull();
      await act(async () => setPreview(false));
      expect(find("search-field")?.getAttribute("value")).toBe("arcade");
      expect(find("search-tab-channels")?.getAttribute("data-selected")).toBe(
        "true",
      );

      await click("clear-search-field");
      expect(find("repeat-search-arcade")).not.toBeNull();
      await click("search-clear-history");
      expect(find("search-clear-confirm")).not.toBeNull();
      await click("search-tab-all");
      expect(find("search-clear-confirm")).toBeNull();
      expect(find("repeat-search-shroud")).not.toBeNull();
      await click("repeat-search-shroud");
      expect(find("search-field")?.getAttribute("value")).toBe("shroud");
      await click("clear-search-field");
      await click("remove-search-shroud");
      expect(stored.all).toEqual([]);
      expect(stored.channels).toEqual([{ label: "arcade" }]);
      await click("search-back");
      expect(find("search-field")).toBeNull();
      expect(find("categories-search-entry")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.clear();
      inputState.props = null;
    }
  });
});
