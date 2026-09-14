import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MiniPlayer } from "../components/mini-player";
import type { WatchPeek, WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFill: {},
    hairlineWidth: 1,
  },
  Text: "Text",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  numberOfLines?: number;
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

const peek: Extract<WatchPeek, { kind: "active" }> = {
  kind: "active",
  muted: false,
  presentation: {
    pip: "idle",
    presentation: "mini",
    previous: "watch",
    snapRegion: "bottom-end",
  },
  progress: {
    durationMs: 0,
    positionMs: 0,
    seekable: false,
  },
  quality: "auto",
  qualities: ["auto"],
  state: {
    integration: "twitch-gql-usher",
    kind: "active",
    phase: "playing",
    policySequence: 1,
    protection: { kind: "normal" },
    session: { pictureInPictureEligible: true, sessionId: "watch:1" },
    target,
  },
  volume: 1,
};

describe("mini-player", () => {
  it("exposes a 48dp Expand action and named snap relocation", () => {
    const root = MiniPlayer({
      onDismiss: () => undefined,
      onExpand: () => undefined,
      onPause: () => undefined,
      onRelocate: () => undefined,
      peek,
    });
    const nodes = descendants(root);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "mini-player-expand" &&
          node.props.accessibilityLabel === "Expand mini-player",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "mini-player-pause")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "mini-player-relocate"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "dismiss-player")).toBe(
      true,
    );
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Move to bottom-start"),
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "mini-player-title" &&
          node.props.numberOfLines === 1,
      ),
    ).toBe(true);
  });
});
