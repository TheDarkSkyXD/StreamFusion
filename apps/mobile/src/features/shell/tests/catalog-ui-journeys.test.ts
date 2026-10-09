import {
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
} from "react";
import type { FlatListProps } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import { describe, expect, it, vi } from "vitest";

import { CategoriesView } from "@mobile/features/discovery/components/categories-screen";
import { CategoryDetailView } from "@mobile/features/discovery/components/category-detail-screen";
import { ChannelDetailBody } from "@mobile/features/discovery/components/channel-detail-screen";
import { HomeLiveDiscoveryView } from "@mobile/features/discovery/components/home-live-discovery-screen";
import { UnifiedSearchView } from "@mobile/features/discovery/components/unified-search-screen";
import { composeCategoryCatalog } from "@mobile/features/discovery/domain/category-catalog";
import { composeCategoryDetail } from "@mobile/features/discovery/domain/category-detail";
import { defaultCategoryRequest } from "@mobile/features/discovery/domain/category-identity";
import {
  fixtureCategory,
  fixtureOutcome,
} from "@mobile/features/discovery/domain/discovery-fixture";
import { fixtureChannelDetail } from "@mobile/features/discovery/domain/channel-fixture";
import { composeHomeLiveDiscovery } from "@mobile/features/discovery/domain/home-live-discovery";
import {
  fixtureSearchIntent,
  fixtureSearchOutcome,
} from "@mobile/features/discovery/domain/search-fixture";
import { emptySearchHistory } from "@mobile/features/discovery/domain/search-history";
import { composeUnifiedSearch } from "@mobile/features/discovery/domain/unified-search";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  FlatList(props: FlatListProps<Stream>) {
    const slot = (value: FlatListProps<Stream>["ListHeaderComponent"]) =>
      typeof value === "function" ? createElement(value) : value;
    return createElement(
      Fragment,
      null,
      slot(props.ListHeaderComponent),
      props.data?.map((item, index) =>
        props.renderItem?.({
          item,
          index,
          separators: {
            highlight() {},
            unhighlight() {},
            updateProps() {},
          },
        }),
      ),
      slot(props.ListFooterComponent),
    );
  },
  Image: "Image",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Bell: "Bell",
  BellOff: "BellOff",
  Check: "Check",
  ChevronDown: "ChevronDown",
  ChevronRight: "ChevronRight",
}));

const i18nTest = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => {
    if (options && "name" in options) return `${key}:${String(options.name)}`;
    return key;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  onPress?: () => void;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) {
    try {
      return [element, ...descendants(component(element.props))];
    } catch {
      // Hooked design components (e.g. MobileSelect) cannot run as plain functions.
      return [element];
    }
  }
  const children = element.props.children;
  return [
    element,
    ...(Array.isArray(children) ? children : [children]).flatMap(descendants),
  ];
}

function press(nodes: readonly Element[], testID: string): void {
  nodes.find((node) => node.props.testID === testID)?.props.onPress?.();
}

const chatting = {
  boxArtUrl: "https://example.com/box.png",
  id: "509658",
  name: "Just Chatting",
  otherId: "15",
  platform: "twitch" as const,
};

// Guards: catalog journeys keep navigation, retry, and empty/error distinct from ready cards
describe("catalog UI journeys", () => {
  it("shows Watch live cards and automatic Twitch recovery", () => {
    const ready = descendants(
      HomeLiveDiscoveryView({
        onOpenAccounts: () => undefined,
        onOpenChannel: () => undefined,
        view: composeHomeLiveDiscovery({
          kick: fixtureOutcome("kick", "ready"),
          loading: false,
          twitch: fixtureOutcome("twitch", "ready"),
        }),
      }),
    );
    expect(
      ready.some((node) => node.props.testID === "home-live-discovery"),
    ).toBe(true);
    expect(
      ready.some((node) => node.props.testID === "home-featured-carousel"),
    ).toBe(false);
    expect(ready.some((node) => node.props.testID === "home-categories")).toBe(
      false,
    );
    const failed = descendants(
      HomeLiveDiscoveryView({
        onOpenAccounts: () => undefined,
        onOpenChannel: () => undefined,
        view: composeHomeLiveDiscovery({
          kick: fixtureOutcome("kick", "ready"),
          loading: false,
          twitch: fixtureOutcome("twitch", "twitch-fail"),
        }),
      }),
    );
    expect(
      failed.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(false);
    expect(
      failed.some(
        (node) => node.props.children === "Twitch catalog read failed. Reconnecting…",
      ),
    ).toBe(true);
  });

  it("opens a category card and keeps loaded cards while the catalog reconnects", () => {
    const opened: string[] = [];
    const ready = descendants(
      CategoriesView({
        onChangeLanguage: () => undefined,
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        onOpenCategory: (category) => opened.push(category.id),
        view: composeCategoryCatalog({
          kick: {
            ...fixtureOutcome("kick", "ready"),
            items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
          },
          language: "all",
          loading: false,
          query: "",
          twitch: {
            ...fixtureOutcome("twitch", "ready"),
            items: [fixtureCategory("twitch", "509658", "Just Chatting", 30)],
          },
        }),
      }),
    );
    press(ready, "category-card-twitch-509658");
    expect(opened).toEqual(["509658"]);
    const failed = descendants(
      CategoriesView({
        onChangeLanguage: () => undefined,
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        onOpenCategory: () => undefined,
        refreshing: true,
        view: composeCategoryCatalog({
          kick: {
            ...fixtureOutcome("kick", "ready"),
            items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
          },
          language: "all",
          loading: false,
          query: "",
          twitch: { ...fixtureOutcome("twitch", "twitch-fail"), items: [] },
        }),
      }),
    );
    expect(
      failed.some((node) => node.props.testID === "category-card-kick-15"),
    ).toBe(true);
    expect(
      failed.some(
        (node) => node.props.accessibilityLabel === "Loading categories",
      ),
    ).toBe(true);
    expect(
      failed.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(false);
  });

  it("filters merged categories to the selected provider identity", () => {
    const opened: string[] = [];
    const selected: string[] = [];
    const nodes = descendants(
      CategoriesView({
        onChangeLanguage: () => undefined,
        onChangePlatform: (platform) => selected.push(platform),
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        onOpenCategory: (category) =>
          opened.push(`${category.platform}:${category.id}`),
        onRetry: () => undefined,
        platform: "kick",
        view: composeCategoryCatalog({
          kick: {
            ...fixtureOutcome("kick", "ready"),
            items: [fixtureCategory("kick", "15", "Just Chatting", 10)],
          },
          language: "all",
          loading: false,
          query: "",
          twitch: {
            ...fixtureOutcome("twitch", "ready"),
            items: [fixtureCategory("twitch", "509658", "Just Chatting", 30)],
          },
        }),
      }),
    );
    press(nodes, "category-card-kick-15");
    press(nodes, "categories-platform-twitch");
    expect(opened).toEqual(["kick:15"]);
    expect(selected).toEqual(["twitch"]);
    expect(
      nodes.some((node) => node.props.testID === "category-card-twitch-509658"),
    ).toBe(false);
  });

  it("shows the shared loading cards while the popular catalog is pending", () => {
    const nodes = descendants(
      CategoriesView({
        onChangeLanguage: () => undefined,
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        onOpenCategory: () => undefined,
        onRetry: () => undefined,
        view: composeCategoryCatalog({
          language: "all",
          loading: true,
          query: "",
        }),
      }),
    );
    expect(
      nodes.filter(
        (node) => node.props.accessibilityLabel === "Loading content",
      ),
    ).toHaveLength(3);
  });

  it("follows a live channel and shows category recovery", () => {
    const followed: string[] = [];
    const channel = descendants(
      ChannelDetailBody({
        channel: {
          id: "twitch-c1",
          platform: "twitch",
          username: "twitch-live",
        },
        onFollow: () => followed.push("follow"),
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        tab: "home",
        view: fixtureChannelDetail(
          { id: "twitch-c1", platform: "twitch", username: "twitch-live" },
          "ready",
        ),
      }),
    );
    press(channel, "channel-follow");
    expect(followed).toEqual(["follow"]);
    const detail = descendants(
      CategoryDetailView({
        onChangeIdentity: () => undefined,
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        query: "",
        recovering: true,
        view: composeCategoryDetail({
          identity: defaultCategoryRequest(chatting, "all", "all"),
          loading: false,
          twitch: fixtureOutcome("twitch", "twitch-fail"),
        }),
      }),
    );
    expect(
      detail.some((node) => node.props.testID === "category-loading"),
    ).toBe(true);
    expect(
      detail.some((node) => node.props.testID === "category-detail-phase"),
    ).toBe(true);
    expect(
      detail.some((node) => node.props.testID === "home-retry-twitch"),
    ).toBe(false);
  });

  it("repeats Search history and retries a failed Search catalog", () => {
    const repeated: string[] = [];
    const retried: string[] = [];
    const history = descendants(
      UnifiedSearchView({
        draft: "arcade",
        liveOnly: false,
        mode: "search",
        onCancelClear: () => undefined,
        onChangeDraft: () => undefined,
        onClearDraft: () => undefined,
        onConfirmClear: () => undefined,
        onOpenAccounts: () => undefined,
        onRemoveHistory: () => undefined,
        onRepeatHistory: (entry) =>
          repeated.push(typeof entry === "string" ? entry : entry.label),
        onRequestClear: () => undefined,
        onRetry: () => undefined,
        onSelectMode: () => undefined,
        onSelectPlatform: () => undefined,
        onSelectTab: () => undefined,
        onSubmit: () => undefined,
        onToggleLiveOnly: () => undefined,
        platform: "all",
        tab: "all",
        view: composeUnifiedSearch({
          history: { ...emptySearchHistory(), channels: [{ label: "arcade" }] },
          intent: null,
          kick: fixtureSearchOutcome("kick", "ready"),
          loading: false,
          twitch: fixtureSearchOutcome("twitch", "ready"),
        }),
      }),
    );
    press(history, "repeat-search-arcade");
    expect(repeated).toEqual(["arcade"]);
    const failed = descendants(
      UnifiedSearchView({
        draft: "arcade",
        liveOnly: false,
        onCancelClear: () => undefined,
        onChangeDraft: () => undefined,
        onClearDraft: () => undefined,
        onConfirmClear: () => undefined,
        onOpenAccounts: () => undefined,
        onRemoveHistory: () => undefined,
        onRepeatHistory: () => undefined,
        onRequestClear: () => undefined,
        onRetry: (platform) => retried.push(platform),
        onSelectPlatform: () => undefined,
        onSelectTab: () => undefined,
        onSubmit: () => undefined,
        onToggleLiveOnly: () => undefined,
        platform: "all",
        tab: "all",
        view: composeUnifiedSearch({
          history: emptySearchHistory(),
          intent: fixtureSearchIntent("arcade"),
          kick: fixtureSearchOutcome("kick", "ready"),
          loading: false,
          twitch: fixtureSearchOutcome("twitch", "twitch-fail"),
        }),
      }),
    );
    press(failed, "search-retry-twitch");
    expect(retried).toEqual(["twitch"]);
  });
});
