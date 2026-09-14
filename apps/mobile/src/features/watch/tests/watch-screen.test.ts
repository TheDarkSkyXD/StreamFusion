import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { WatchScreen } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";

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

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

describe("watch screen", () => {
  it("requires an explicit start and keeps chat disconnected", () => {
    const root = WatchScreen({
      PlayerSurface: () => null,
      chat: {
        detail: "Chat is not connected in this build. Watching continues.",
        kind: "not-connected",
      },
      inspection: null,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onStart: () => undefined,
      playback: { kind: "ready", target },
      tab: "chat",
      target,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "watch-start")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-player")).toBe(
      false,
    );
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Chat is not connected"),
      ),
    ).toBe(true);
  });
});
