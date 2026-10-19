// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CategoryFilterBar } from "../components/category-filter-bar";
import type { CategoryRequestIdentity } from "../domain/category-identity";

vi.mock("react-native", () => {
  type HostProps = {
    readonly accessibilityLabel?: string;
    readonly children?: ReactNode;
    readonly disabled?: boolean;
    readonly onPress?: () => void;
    readonly onChangeText?: (value: string) => void;
    readonly placeholder?: string;
    readonly role?: string;
    readonly testID?: string;
    readonly value?: string;
    readonly visible?: boolean;
  };
  const host = (tag: string) =>
    function Host(props: HostProps) {
      return createElement(
        tag,
        {
          "aria-label": props.accessibilityLabel,
          "data-testid": props.testID,
          disabled: props.disabled,
          onClick: props.onPress,
          role: props.role,
        },
        props.children,
      );
    };
  return {
    KeyboardAvoidingView: host("div"),
    Modal: (props: HostProps) => (props.visible ? host("div")(props) : null),
    Platform: { OS: "android" },
    Pressable: host("button"),
    ScrollView: host("div"),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host("span"),
    TextInput: (props: HostProps) =>
      createElement("input", {
        "aria-label": props.accessibilityLabel,
        "data-testid": props.testID,
        onChange: (event: { currentTarget: HTMLInputElement }) =>
          props.onChangeText?.(event.currentTarget.value),
        placeholder: props.placeholder,
        value: props.value,
      }),
    View: host("div"),
  };
});

vi.mock("lucide-react-native", () => ({
  ChevronDown: () => null,
  ChevronUp: () => null,
  SlidersHorizontal: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const initialIdentity: CategoryRequestIdentity = {
  category: {
    boxArtUrl: "https://example.com/just-chatting.jpg",
    id: "509658",
    name: "Just Chatting",
    otherId: "15",
    platform: "twitch",
  },
  clipSort: "views",
  clipTimeRange: "all",
  language: "all",
  liveSort: "viewers-desc",
  platformScope: "all",
  tab: "live",
  tag: "all",
  videoSort: "recent",
};

async function mountFilter(initial = initialIdentity) {
  const changes: CategoryRequestIdentity[] = [];
  function ControlledFilter() {
    const [identity, setIdentity] = useState(initial);
    return createElement(CategoryFilterBar, {
      identity,
      onChange: (next) => {
        changes.push(next);
        setIdentity(next);
      },
    });
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(ControlledFilter)));
  const mounted = container;
  async function click(testID: string) {
    const button = mounted.querySelector<HTMLButtonElement>(
      `[data-testid='${testID}']`,
    );
    if (!button) throw new Error(`Missing ${testID}`);
    await act(async () => button.click());
  }
  async function typeTag(value: string) {
    const input = mounted.querySelector<HTMLInputElement>(
      "[data-testid='category-tag-search']",
    );
    if (!input) throw new Error("Missing tag search");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Missing native input setter");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  return { changes, click, container: mounted, typeTag };
}

describe("category filters", () => {
  it("keeps language and sort choices in the request while filters close and reopen", async () => {
    const screen = await mountFilter();
    const toggle = screen.container.querySelector<HTMLButtonElement>(
      "[data-testid='category-filters-toggle']",
    );
    if (!toggle) throw new Error("Missing filters toggle");
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · All languages · Most viewers",
    );
    expect(
      screen.container.querySelector("[data-testid='category-language']"),
    ).toBeNull();

    await screen.click("category-filters-toggle");
    expect(
      screen.container.querySelector("[data-testid='category-platform-all']"),
    ).not.toBeNull();
    expect(
      screen.container.querySelector(
        "[data-testid='category-platform-twitch']",
      ),
    ).not.toBeNull();
    expect(
      screen.container.querySelector("[data-testid='category-platform-kick']"),
    ).not.toBeNull();
    expect(
      screen.container.querySelector<HTMLInputElement>(
        "[data-testid='category-tag-search']",
      )?.placeholder,
    ).toBe("Search tags");
    await screen.click("category-language-trigger");
    await screen.click("category-language-option-en");
    expect(screen.changes).toEqual([]);
    await screen.click("category-filters-apply");
    expect(screen.changes).toEqual([{ ...initialIdentity, language: "en" }]);
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · English · Most viewers",
    );

    expect(
      screen.container.querySelector("[data-testid='category-language']"),
    ).toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · English · Most viewers",
    );
    await screen.click("category-filters-toggle");
    expect(
      screen.container
        .querySelector("[data-testid='category-language-trigger']")
        ?.getAttribute("aria-label"),
    ).toBe("Language, English");
    await screen.click("category-sort-trigger");
    await screen.click("category-sort-option-viewers-asc");
    expect(screen.changes).toHaveLength(1);
    await screen.click("category-filters-apply");
    expect(screen.changes).toEqual([
      { ...initialIdentity, language: "en" },
      { ...initialIdentity, language: "en", liveSort: "viewers-asc" },
    ]);
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · English · Fewest viewers",
    );
    await screen.click("category-filters-toggle");
    expect(
      screen.container
        .querySelector("[data-testid='category-sort-trigger']")
        ?.getAttribute("aria-label"),
    ).toBe("Sort, Fewest viewers");
  });

  it("edits an active tag as a draft and clears it on apply", async () => {
    const screen = await mountFilter({ ...initialIdentity, tag: "Cozy" });
    const toggle = screen.container.querySelector<HTMLButtonElement>(
      "[data-testid='category-filters-toggle']",
    );
    if (!toggle) throw new Error("Missing filters toggle");
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · All languages · Most viewers · Cozy",
    );
    await screen.click("category-filters-toggle");
    const input = screen.container.querySelector<HTMLInputElement>(
      "[data-testid='category-tag-search']",
    );
    expect(input?.value).toBe("Cozy");
    await screen.typeTag("   ");
    expect(screen.changes).toEqual([]);
    await screen.click("category-filters-apply");
    expect(screen.changes).toEqual([{ ...initialIdentity, tag: "all" }]);
    expect(
      screen.container.querySelector("[data-testid='category-tag-search']"),
    ).toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe(
      "Filters, All platforms · All languages · Most viewers",
    );
  });

  it("does not offer a live tag on the clips tab", async () => {
    const screen = await mountFilter({
      ...initialIdentity,
      tab: "clips",
      tag: "Cozy",
    });
    await screen.click("category-filters-toggle");
    expect(
      screen.container.querySelector("[data-testid='category-tag-search']"),
    ).toBeNull();
    expect(
      screen.container.querySelector("[data-testid='category-clip-time-all']"),
    ).not.toBeNull();
  });

  it("keeps tag search below sort and resets pending choices", async () => {
    const screen = await mountFilter();
    await screen.click("category-filters-toggle");
    const sort = screen.container.querySelector(
      "[data-testid='category-sort']",
    );
    const tag = screen.container.querySelector(
      "[data-testid='category-tag-search']",
    );
    expect(tag).not.toBeNull();
    expect(
      sort?.compareDocumentPosition(tag ?? sort) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.container.querySelectorAll("[data-testid^='category-tag-']"),
    ).toHaveLength(1);
    await screen.typeTag("  coz  ");
    expect(screen.changes).toEqual([]);
    await screen.click("category-filters-apply");
    expect(screen.changes).toEqual([{ ...initialIdentity, tag: "coz" }]);
    await screen.click("category-filters-toggle");
    expect(
      screen.container.querySelector<HTMLInputElement>(
        "[data-testid='category-tag-search']",
      )?.value,
    ).toBe("coz");
    await screen.click("category-filters-reset");
    await screen.click("category-filters-apply");
    expect(screen.changes).toEqual([
      { ...initialIdentity, tag: "coz" },
      initialIdentity,
    ]);
  });
});
