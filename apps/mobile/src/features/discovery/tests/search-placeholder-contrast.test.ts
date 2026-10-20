import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { mobileColors } from "@mobile/design/tokens";

import { DiscoverySearchDock } from "../components/discovery-search-dock";
import { SearchDock } from "../components/search-dock";

interface AxeColor {
  parseString(value: string): void;
}

declare module "axe-core" {
  interface Commons {
    color: {
      Color: new () => AxeColor;
      getContrast(background: AxeColor, foreground: AxeColor): number | null;
    };
  }
}

vi.mock("react-native", () => ({
  Keyboard: { dismiss() {} },
  Pressable: "button",
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: (props: { placeholderTextColor?: string; testID?: string }) =>
    createElement("input", {
      "data-placeholder-color": props.placeholderTextColor,
      "data-testid": props.testID,
    }),
  View: (props: { children?: ReactNode; testID?: string }) =>
    createElement("div", { "data-testid": props.testID }, props.children),
}));

vi.mock("lucide-react-native", () => ({
  ArrowLeft: () => null,
  Search: () => null,
  X: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { Color, getContrast } = axe.commons.color;

function contrast(foreground: string, background: string): number {
  const foregroundColor = new Color();
  const backgroundColor = new Color();
  foregroundColor.parseString(foreground);
  backgroundColor.parseString(background);
  const ratio = getContrast(backgroundColor, foregroundColor);
  if (ratio === null)
    throw new Error("Could not calculate placeholder contrast");
  return ratio;
}

function renderedPlaceholderColor(element: React.ReactElement): string {
  const html = renderToStaticMarkup(element);
  const color = html.match(/data-placeholder-color="([^"]+)"/)?.[1];
  if (!color)
    throw new Error(`Rendered search field has no placeholder color: ${html}`);
  return color;
}

describe("mobile search placeholder contrast", () => {
  it.each([
    [
      "search dock",
      createElement(SearchDock, {
        onChangeText: () => undefined,
        onClear: () => undefined,
        onSubmit: () => undefined,
        value: "",
      }),
    ],
    [
      "discovery search dock",
      createElement(DiscoverySearchDock, {
        onChangeQuery: () => undefined,
        placeholder: "Search",
        query: "",
        testID: "discovery-search",
      }),
    ],
  ])("keeps the rendered %s placeholder at 4.5:1 or better", (_, element) => {
    expect(
      contrast(renderedPlaceholderColor(element), mobileColors.surfaceMuted),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
