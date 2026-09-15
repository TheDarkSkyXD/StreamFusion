import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AdBlockSettingsView } from "../components/adblock-settings-panel";
import { composeAdBlockView } from "../domain/adblock-policy";

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
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("adblock settings view", () => {
  it("renders the kill switch, methods, and provider disclosure", () => {
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: true, method: "strip" },
    });
    const nodes = descendants(
      AdBlockSettingsView({
        busy: false,
        onSave: () => undefined,
        view,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "panel-adblock")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "adblock")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "adblock-method-canary"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "adblock-kick-support"),
    ).toBe(true);
  });

  it("saves canary from the assigned control", () => {
    let method = "strip";
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: true, method: "strip" },
    });
    const nodes = descendants(
      AdBlockSettingsView({
        busy: false,
        onSave: (next) => {
          method = next.method;
        },
        view,
      }),
    );
    nodes.find((node) => node.props.testID === "adblock-method-canary")?.props
      .onPress?.();
    expect(method).toBe("canary");
  });
});
