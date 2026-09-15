import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import { composeSettingsView } from "../domain/settings-view";
import { AppearanceSettingsPanel } from "../components/settings-panels";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
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
  return (candidate as (props: ElementProps) => unknown)(element.props);
}

function childNodes(element: Element): readonly unknown[] {
  const children = element.props.children;
  return Array.isArray(children) ? children : [children];
}

function hasTestId(nodes: readonly Element[], testID: string): boolean {
  return nodes.some((node) => node.props.testID === testID);
}

// Guards: Appearance panel stays dark-only and still exposes density and restore controls
describe("settings panels", () => {
  it("renders dark-only theme copy and changes density from the assigned button", () => {
    let density = DEFAULT_PRODUCT_PREFERENCES.density;
    const nodes = descendants(
      AppearanceSettingsPanel({
        onChange: (patch) => {
          if (patch.density) density = patch.density;
        },
        view: composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES }),
      }),
    );
    expect(hasTestId(nodes, "panel-appearance")).toBe(true);
    expect(hasTestId(nodes, "theme")).toBe(true);
    expect(hasTestId(nodes, "theme-light")).toBe(false);
    expect(hasTestId(nodes, "restore-session")).toBe(true);
    nodes.find((node) => node.props.testID === "density-compact")?.props.onPress?.();
    expect(density).toBe("compact");
  });
});
