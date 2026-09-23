import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import { composeSettingsView } from "../domain/settings-view";
import {
  settingsCategoriesForPanels,
  settingsCategoryTitle,
} from "../domain/settings-categories";
import { AppearanceSettingsPanel } from "../components/settings-panels";
import {
  SettingsCategoryDetail,
  SettingsHub,
} from "../components/settings-workspace";
import type { SettingsSession } from "../capabilities/settings";

vi.mock("react-native", () => ({
  BackHandler: {
    addEventListener: () => ({ remove: () => undefined }),
  },
  Modal: "Modal",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: {
    absoluteFill: {},
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Switch: "Switch",
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));

vi.mock("lucide-react-native", () => {
  const Icon = () => null;
  return {
    Check: Icon,
    ChevronDown: Icon,
    Activity: Icon,
    ArrowLeft: Icon,
    Bell: Icon,
    Bug: Icon,
    ChevronRight: Icon,
    CircleHelp: Icon,
    FileText: Icon,
    Gauge: Icon,
    KeyRound: Icon,
    MessageSquare: Icon,
    MonitorPlay: Icon,
    Palette: Icon,
    RefreshCw: Icon,
    ShieldBan: Icon,
    SlidersHorizontal: Icon,
    Target: Icon,
    Users: Icon,
    Wifi: Icon,
    X: Icon,
  };
});

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  onSelect?: (value: string) => void;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const rendered = renderFunction(element);
  if (rendered) return [element, ...descendants(rendered)];
  return [element, ...childNodes(element).flatMap((child) => descendants(child))];
}

function renderFunction(element: Element): unknown {
  const candidate = element.type as unknown;
  if (typeof candidate !== "function") return null;
  try {
    return (candidate as (props: ElementProps) => unknown)(element.props);
  } catch {
    return null;
  }
}

function childNodes(element: Element): readonly unknown[] {
  const children = element.props.children;
  return Array.isArray(children) ? children : [children];
}

function hasTestId(nodes: readonly Element[], testID: string): boolean {
  return nodes.some((node) => node.props.testID === testID);
}

function fakeSession(): SettingsSession {
  const view = composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES });
  return {
    apply: async () => view,
    load: async () => view,
    peek: () => view,
    read: async () => view.preferences,
    search: async () => view,
    snapshot: () => view.preferences,
    subscribe: () => () => undefined,
  };
}

vi.mock("@mobile/design/haptics", () => ({
  selectionHaptic: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// Guards: Appearance stays dark-only for theme, exposes full display-language picker, density, restore
describe("settings panels", () => {
  it("renders dark-only theme copy, language options, and changes density", () => {
    let density = DEFAULT_PRODUCT_PREFERENCES.density;
    let language = DEFAULT_PRODUCT_PREFERENCES.language;
    const nodes = descendants(
      AppearanceSettingsPanel({
        onChange: (patch) => {
          if (patch.density) density = patch.density;
          if (typeof patch.language === "string") language = patch.language as typeof language;
        },
        view: composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES }),
      }),
    );
    expect(hasTestId(nodes, "panel-appearance")).toBe(true);
    expect(hasTestId(nodes, "theme")).toBe(true);
    expect(hasTestId(nodes, "theme-light")).toBe(false);
    expect(hasTestId(nodes, "language")).toBe(true);
    expect(hasTestId(nodes, "language-picker")).toBe(true);
    expect(hasTestId(nodes, "density")).toBe(true);
    expect(hasTestId(nodes, "restore-session")).toBe(true);
    const densityRow = nodes.find((node) => node.props.testID === "density");
    densityRow?.props.onSelect?.("compact");
    expect(density).toBe("compact");
    const languageRow = nodes.find((node) => node.props.testID === "language");
    languageRow?.props.onSelect?.("fr");
    expect(language).toBe("fr");
  });

  it("shows the selected language with its native self-name on Appearance", () => {
    const french = composeSettingsView({
      preferences: { ...DEFAULT_PRODUCT_PREFERENCES, language: "fr" },
    });
    expect(french.effective.language).toBe("Interface language: Français.");
    const spanish = composeSettingsView({
      preferences: { ...DEFAULT_PRODUCT_PREFERENCES, language: "es" },
    });
    expect(spanish.effective.language).toBe("Interface language: Español.");
    const nodes = descendants(
      AppearanceSettingsPanel({
        onChange: () => undefined,
        view: french,
      }),
    );
    expect(hasTestId(nodes, "language-effective")).toBe(true);
    const effective = nodes.find((node) => node.props.testID === "language-effective");
    const copy = String(
      (effective?.props as { readonly value?: string }).value ??
        effective?.props.children ??
        "",
    );
    expect(copy).toContain("Français");
  });
});

describe("settings hub navigation", () => {
  it("lists Frosty-style category tiles instead of dumping every panel", () => {
    const view = composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES });
    const nodes = descendants(
      SettingsHub({
        onOpenPanel: () => undefined,
        view,
      }),
    );
    expect(hasTestId(nodes, "settings-hub")).toBe(true);
    expect(hasTestId(nodes, "settings-category-appearance")).toBe(true);
    expect(hasTestId(nodes, "settings-category-playback")).toBe(true);
    expect(hasTestId(nodes, "settings-category-chat")).toBe(true);
    expect(hasTestId(nodes, "panel-appearance")).toBe(false);
  });

  it("filters hub tiles from search and exposes control deep-links", () => {
    const view = composeSettingsView({
      preferences: DEFAULT_PRODUCT_PREFERENCES,
      query: "proxy",
    });
    expect(view.panels).toEqual(["proxy"]);
    const categories = settingsCategoriesForPanels(view.panels);
    expect(categories.map((category) => category.id)).toEqual(["proxy"]);
    expect(settingsCategoryTitle("proxy")).toBe("Proxy");

    const nodes = descendants(
      SettingsHub({
        onOpenPanel: () => undefined,
        view,
      }),
    );
    expect(hasTestId(nodes, "settings-category-proxy")).toBe(true);
    expect(hasTestId(nodes, "settings-category-appearance")).toBe(false);
    expect(hasTestId(nodes, "settings-search-matches")).toBe(true);
  });

  it("shows the full category set when the hub query is empty", () => {
    const view = composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES });
    expect(view.query).toBe("");
    const categories = settingsCategoriesForPanels(view.panels);
    const categoryIds = categories.map((category) => category.id);
    expect(categoryIds).toEqual(
      expect.arrayContaining([
        "appearance",
        "playback",
        "chat",
        "adblock",
        "proxy",
        "notifications",
      ]),
    );
    expect(categoryIds).not.toContain("multiview");
    expect(view.panels).not.toContain("multiview");
    expect(categories.length).toBeGreaterThan(8);

    const nodes = descendants(
      SettingsHub({
        onOpenPanel: () => undefined,
        view,
      }),
    );
    expect(hasTestId(nodes, "settings-category-appearance")).toBe(true);
    expect(hasTestId(nodes, "settings-category-playback")).toBe(true);
    expect(hasTestId(nodes, "settings-category-chat")).toBe(true);
    expect(hasTestId(nodes, "settings-category-adblock")).toBe(true);
    expect(hasTestId(nodes, "settings-category-proxy")).toBe(true);
    expect(hasTestId(nodes, "settings-category-multiview")).toBe(false);
    expect(hasTestId(nodes, "settings-search-matches")).toBe(false);
  });

  it("keeps Language matches for lang and restores every category when cleared", () => {
    const filtered = composeSettingsView({
      preferences: DEFAULT_PRODUCT_PREFERENCES,
      query: "lang",
    });
    expect(filtered.panels).toContain("appearance");
    expect(filtered.matches.some((match) => match.id === "language")).toBe(true);
    expect(filtered.panels).not.toContain("proxy");

    const filteredNodes = descendants(
      SettingsHub({
        onOpenPanel: () => undefined,
        view: filtered,
      }),
    );
    expect(hasTestId(filteredNodes, "settings-category-appearance")).toBe(true);
    expect(hasTestId(filteredNodes, "settings-search-matches")).toBe(true);
    expect(hasTestId(filteredNodes, "settings-category-playback")).toBe(false);
    expect(hasTestId(filteredNodes, "settings-category-proxy")).toBe(false);

    const cleared = composeSettingsView({
      preferences: DEFAULT_PRODUCT_PREFERENCES,
      query: "",
    });
    const clearedNodes = descendants(
      SettingsHub({
        onOpenPanel: () => undefined,
        view: cleared,
      }),
    );
    expect(hasTestId(clearedNodes, "settings-category-appearance")).toBe(true);
    expect(hasTestId(clearedNodes, "settings-category-playback")).toBe(true);
    expect(hasTestId(clearedNodes, "settings-category-chat")).toBe(true);
    expect(hasTestId(clearedNodes, "settings-category-adblock")).toBe(true);
    expect(hasTestId(clearedNodes, "settings-category-proxy")).toBe(true);
    expect(hasTestId(clearedNodes, "settings-search-matches")).toBe(false);
  });


  it("hides Multiview from search matches and panels", () => {
    const view = composeSettingsView({
      preferences: DEFAULT_PRODUCT_PREFERENCES,
      query: "multiview",
    });
    expect(view.panels).not.toContain("multiview");
    expect(view.matches.every((match) => match.panel !== "multiview")).toBe(true);
    expect(view.panels).toEqual([]);
  });

  it("opens a single category detail with only that panel", () => {
    const view = composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES });
    let opened: string | null = null;
    const hub = descendants(
      SettingsHub({
        onOpenPanel: (panel) => {
          opened = panel;
        },
        view,
      }),
    );
    hub.find((node) => node.props.testID === "settings-category-appearance")
      ?.props.onPress?.();
    expect(opened).toBe("appearance");

    const detail = descendants(
      SettingsCategoryDetail({
        extras: {},
        gap: 16,
        onBack: () => undefined,
        panel: "appearance",
        session: fakeSession(),
        view,
      }),
    );
    expect(hasTestId(detail, "screen-more-settings-appearance")).toBe(true);
    expect(hasTestId(detail, "settings-category-back")).toBe(true);
    expect(hasTestId(detail, "panel-appearance")).toBe(true);
    expect(hasTestId(detail, "panel-playback")).toBe(false);
  });

  it("clears hub search on enter and exposes a clear control", () => {
    const source = readFileSync(
      new URL("../components/settings-workspace.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('void session.search("")');
    expect(source).toContain('testID="settings-search-clear"');
    expect(source).toContain("Clear settings search");
  });
});
