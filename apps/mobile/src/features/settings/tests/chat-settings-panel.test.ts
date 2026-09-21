import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChatSettingsView } from "../components/chat-settings-panel";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  composeChatDisplaySettingsView,
  mergeChatDisplayPreferences,
  parseChatDisplayPreferences,
  serializeChatDisplayPreferences,
} from "../domain/chat-display-preferences";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
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

describe("chat display preferences", () => {
  it("round-trips desktop-compatible chatDisplay fields", () => {
    const next = mergeChatDisplayPreferences(DEFAULT_CHAT_DISPLAY_PREFERENCES, {
      density: "compact",
      timestamps: true,
      enable7tv: false,
      messageLimit: 400,
    });
    const raw = serializeChatDisplayPreferences(next);
    expect(parseChatDisplayPreferences(raw)).toMatchObject({
      density: "compact",
      timestamps: true,
      enable7tv: false,
      messageLimit: 400,
      fontSizePx: 16,
    });
  });
});

describe("chat settings view", () => {
  it("renders chat panel controls and saves density", () => {
    let density = DEFAULT_CHAT_DISPLAY_PREFERENCES.density;
    const nodes = descendants(
      ChatSettingsView({
        onChange: (patch) => {
          if (patch.density) density = patch.density;
        },
        view: composeChatDisplaySettingsView(DEFAULT_CHAT_DISPLAY_PREFERENCES),
      }),
    );
    expect(nodes.some((node) => node.props.testID === "panel-chat")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "chat-density")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "chat-timestamps")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "chat-emotes-7tv")).toBe(
      true,
    );
    nodes
      .find((node) => node.props.testID === "chat-density-compact")
      ?.props.onPress?.();
    expect(density).toBe("compact");
  });
});
