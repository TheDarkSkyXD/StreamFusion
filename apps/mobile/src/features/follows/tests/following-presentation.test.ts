// @vitest-environment jsdom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { FollowingSession } from "../capabilities/following-session";
import {
  FollowingScreen,
  type FollowingPresentationState,
} from "../components/following-screen";

const fields = vi.hoisted(() => new Map<string, (value: string) => void>());

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: (props: {
    testID: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => {
    fields.set(props.testID, props.onChangeText);
    return createElement("input", {
      "data-testid": props.testID,
      value: props.value,
      readOnly: true,
    });
  },
  View: (props: { children?: React.ReactNode }) =>
    createElement("div", null, props.children),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@mobile/design/refreshable", () => ({
  MobileRefreshableScroll: (props: { children?: React.ReactNode }) =>
    createElement("div", null, props.children),
}));
vi.mock("@mobile/design/underline-tabs", () => ({
  MobileUnderlineTabs: (props: {
    selectedId: string;
    onSelect: (id: string) => void;
    tabs: readonly { id: string; testID: string }[];
  }) =>
    createElement(
      "div",
      null,
      props.tabs.map((tab) =>
        createElement(
          "button",
          {
            key: tab.id,
            "data-testid": tab.testID,
            "data-selected": props.selectedId === tab.id,
            onClick: () => props.onSelect(tab.id),
          },
          tab.id,
        ),
      ),
    ),
}));
vi.mock("@mobile/design/chip", () => ({
  MobileFilterChip: (props: {
    testID: string;
    selected: boolean;
    onPress: () => void;
    label: string;
  }) =>
    createElement(
      "button",
      {
        "data-testid": props.testID,
        "data-selected": props.selected,
        onClick: props.onPress,
      },
      props.label,
    ),
}));
vi.mock("@mobile/design/button", () => ({
  MobileButton: (props: {
    children?: React.ReactNode;
    onPress: () => void;
    testID?: string;
  }) =>
    createElement(
      "button",
      { "data-testid": props.testID, onClick: props.onPress },
      props.children,
    ),
}));
vi.mock("../components/following-tab-body", () => ({
  FollowingTabBody: (props: {
    view: { tab: string };
    onOpenCategory?: (category: {
      id: string;
      name: string;
      platform: "twitch";
      boxArtUrl: string;
    }) => void;
  }) =>
    props.view.tab === "categories"
      ? createElement(
          "button",
          {
            "data-testid": "open-followed-category",
            onClick: () =>
              props.onOpenCategory?.({
                id: "509658",
                name: "Just Chatting",
                platform: "twitch",
                boxArtUrl: "",
              }),
          },
          "Just Chatting",
        )
      : null,
}));
vi.mock("../components/use-following-view", () => ({
  useFollowingView: (input: { tab: string }) => ({
    refresh: async () => undefined,
    refreshing: false,
    view: { tab: input.tab, live: { kind: "empty", reason: "no-membership" } },
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Following presentation", () => {
  it("restores category tab, platform chip, and query after a category detail", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    function Journey() {
      const saved = useRef<FollowingPresentationState | null>(null);
      const [detail, setDetail] = useState(false);
      return detail
        ? createElement(
            "button",
            { "data-testid": "category-back", onClick: () => setDetail(false) },
            "Back",
          )
        : createElement(FollowingScreen, {
            session: {} as FollowingSession,
            onOpenManage() {},
            onOpenCategory() {
              setDetail(true);
            },
            restoredState: saved.current ?? undefined,
            onStateChange(state) {
              saved.current = state;
            },
          });
    }
    const click = async (id: string) =>
      act(async () => {
        const button = container.querySelector<HTMLButtonElement>(
          `[data-testid="${id}"]`,
        );
        if (!button) throw new Error(`Missing ${id}`);
        button.click();
      });
    try {
      await act(async () => root.render(createElement(Journey)));
      await click("following-tab-categories");
      await click("following-chip-twitch");
      await act(async () => fields.get("following-search")?.("chatting"));
      await click("open-followed-category");
      await click("category-back");
      expect(
        container
          .querySelector('[data-testid="following-tab-categories"]')
          ?.getAttribute("data-selected"),
      ).toBe("true");
      expect(
        container
          .querySelector('[data-testid="following-chip-twitch"]')
          ?.getAttribute("data-selected"),
      ).toBe("true");
      expect(
        container.querySelector<HTMLInputElement>(
          '[data-testid="following-search"]',
        )?.value,
      ).toBe("chatting");
    } finally {
      await act(async () => root.unmount());
      fields.clear();
    }
  });
});
