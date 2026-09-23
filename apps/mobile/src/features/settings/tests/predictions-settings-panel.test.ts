import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { PredictionsSettingsView } from "../components/predictions-settings-panel";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  composePredictionSettingsView,
  mergePredictionPreferences,
  parsePredictionPreferences,
  serializePredictionPreferences,
} from "../domain/prediction-preferences";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  Switch: "Switch",
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

describe("prediction preferences", () => {
  it("round-trips native and unified styles", () => {
    const next = mergePredictionPreferences(DEFAULT_PREDICTION_PREFERENCES, {
      style: "unified",
    });
    expect(parsePredictionPreferences(serializePredictionPreferences(next))).toEqual({
      style: "unified",
    });
  });
});

describe("predictions settings view", () => {
  it("renders style choices and saves unified", () => {
    let style = DEFAULT_PREDICTION_PREFERENCES.style;
    const nodes = descendants(
      PredictionsSettingsView({
        onChange: (patch) => {
          if (patch.style) style = patch.style;
        },
        view: composePredictionSettingsView(DEFAULT_PREDICTION_PREFERENCES),
      }),
    );
    expect(nodes.some((node) => node.props.testID === "panel-predictions")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "prediction-style")).toBe(
      true,
    );
    nodes
      .find((node) => node.props.testID === "prediction-style-unified")
      ?.props.onPress?.();
    expect(style).toBe("unified");
  });
});
