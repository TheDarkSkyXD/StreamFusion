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
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Switch: "Switch",
}));

vi.mock("lucide-react-native", () => ({
  Check: "Check",
  ChevronDown: "ChevronDown",
}));

vi.mock("@react-native-community/slider", () => ({
  default: "Slider",
}));

vi.mock("@mobile/design/haptics", () => ({
  selectionHaptic: vi.fn(async () => undefined),
}));

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  onSelect?: (value: string) => void;
  onValueChange?: (value: number) => void;
  testID?: string;
  value?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
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
  if (component) {
    try {
      return [element, ...descendants(component(element.props))];
    } catch {
      return [element];
    }
  }
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
      .find((node) => node.props.testID === "chat-density")
      ?.props.onSelect?.("compact");
    expect(density).toBe("compact");
  });

  it("renders Frosty-style sliders for desktop RangeRow chat settings", () => {
    let fontSizePx = DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx;
    let emoteSizePx = DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx;
    let messageLimit = DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit;
    const nodes = descendants(
      ChatSettingsView({
        onChange: (patch) => {
          if (typeof patch.fontSizePx === "number") fontSizePx = patch.fontSizePx;
          if (typeof patch.emoteSizePx === "number") emoteSizePx = patch.emoteSizePx;
          if (typeof patch.messageLimit === "number")
            messageLimit = patch.messageLimit;
        },
        view: composeChatDisplaySettingsView(DEFAULT_CHAT_DISPLAY_PREFERENCES),
      }),
    );

    for (const testID of [
      "chat-font-size",
      "chat-emote-size",
      "chat-message-limit",
    ] as const) {
      expect(nodes.some((node) => node.props.testID === testID)).toBe(true);
    }

    const fontInput = nodes.find(
      (node) => node.props.testID === "chat-font-size-input",
    );
    expect(fontInput?.props.minimumValue).toBe(10);
    expect(fontInput?.props.maximumValue).toBe(20);
    expect(fontInput?.props.step).toBe(1);
    fontInput?.props.onValueChange?.(18);
    expect(fontSizePx).toBe(18);

    const emoteInput = nodes.find(
      (node) => node.props.testID === "chat-emote-size-input",
    );
    expect(emoteInput?.props.minimumValue).toBe(16);
    expect(emoteInput?.props.maximumValue).toBe(56);
    emoteInput?.props.onValueChange?.(40);
    expect(emoteSizePx).toBe(40);

    const messageInput = nodes.find(
      (node) => node.props.testID === "chat-message-limit-input",
    );
    expect(messageInput?.props.minimumValue).toBe(100);
    expect(messageInput?.props.maximumValue).toBe(1000);
    expect(messageInput?.props.step).toBe(100);
    messageInput?.props.onValueChange?.(800);
    expect(messageLimit).toBe(800);
  });
});
