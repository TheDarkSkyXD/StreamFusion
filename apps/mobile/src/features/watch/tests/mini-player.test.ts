import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MiniPlayer } from "../components/mini-player";
import type { WatchPeek, WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
    hairlineWidth: 1,
  },
  Text: "Text",
  View: "View",
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

vi.mock("lucide-react-native", () => {
  const Icon = () => null;
  return {
    Move: Icon,
    Pause: Icon,
    PictureInPicture2: Icon,
    Play: Icon,
    X: Icon,
  };
});

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  numberOfLines?: number;
  sessionId?: string;
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

function StubSurface(props: {
  readonly sessionId: string;
  readonly testID?: string;
}): ReactElement {
  return {
    $$typeof: Symbol.for("react.element"),
    type: "NativeSurface",
    key: null,
    ref: null,
    props,
  } as unknown as ReactElement;
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
  it("exposes a floating video card with expand, pause, relocate, pip, and dismiss", () => {
    const root = MiniPlayer({
      PlayerSurface: StubSurface,
      onDismiss: () => undefined,
      onExpand: () => undefined,
      onPause: () => undefined,
      onPip: () => undefined,
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
    expect(nodes.some((node) => node.props.testID === "mini-player-video")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "mini-player-surface")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "mini-player-live")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "mini-player-pause")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "mini-player-pip")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "mini-player-relocate"),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "mini-player-relocate" &&
          node.props.accessibilityLabel === "Move to bottom-start",
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "dismiss-player")).toBe(
      true,
    );
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "mini-player-title" &&
          node.props.numberOfLines === 1,
      ),
    ).toBe(true);
  });

  it("hides the PiP control when the callback is omitted", () => {
    const root = MiniPlayer({
      PlayerSurface: StubSurface,
      onDismiss: () => undefined,
      onExpand: () => undefined,
      onPause: () => undefined,
      onRelocate: () => undefined,
      peek,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "mini-player-pip")).toBe(
      false,
    );
  });
});
