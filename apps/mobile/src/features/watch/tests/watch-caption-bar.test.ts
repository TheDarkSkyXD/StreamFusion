import { isValidElement, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchCaptionBar } from "../components/watch-caption-bar";
import { WatchCaptionOverlay } from "../components/watch-caption-overlay";

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

function byTestId(nodes: readonly Element[], testID: string): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
}

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

describe("Watch caption chrome", () => {
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });

  it("shows Coming soon and never offers Install English model", () => {
    const nodes = descendants(
      WatchCaptionBar({
        eligibility: {
          kind: "eligible",
          label: "Captions",
          sessionId: "cap-twitch-twitch-1",
        },
      }),
    );
    expect(byTestId(nodes, "watch-captions-coming-soon")?.props.children).toMatch(
      /Coming soon/i,
    );
    expect(byTestId(nodes, "watch-captions-install")).toBeUndefined();
    expect(byTestId(nodes, "watch-captions-start")).toBeUndefined();
    expect(byTestId(nodes, "watch-captions-remove")).toBeUndefined();
  });

  it("shows compact Coming soon without install actions", () => {
    const nodes = descendants(
      WatchCaptionBar({
        compact: true,
        eligibility: {
          kind: "eligible",
          label: "Captions",
          sessionId: "cap-twitch-twitch-1",
        },
      }),
    );
    expect(byTestId(nodes, "watch-captions")).toBeTruthy();
    expect(byTestId(nodes, "watch-captions-coming-soon")?.props.children).toMatch(
      /Coming soon/i,
    );
  });

  it("hides the bar when captions are not offered", () => {
    expect(WatchCaptionBar({ eligibility: { kind: "hidden" } })).toBeNull();
  });

  it("renders overlay cue text and stays empty without a cue", () => {
    expect(WatchCaptionOverlay({ text: "" })).toBeNull();
    const nodes = descendants(
      WatchCaptionOverlay({ text: "Decoded program audio stays on this phone." }),
    );
    expect(byTestId(nodes, "watch-caption-cue")?.props.children).toBe(
      "Decoded program audio stays on this phone.",
    );
  });
});
